"""Desktop AI connection using Core snapshots, policy checks and validated results."""

import json
import os
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

from apex_forensic.adapters.ai.openai_compatible import (
    OpenAICompatibleConfig,
    OpenAICompatibleProvider,
)
from apex_forensic.config import AiProviderRuntimeConfig, ServiceBundle
from apex_forensic.domain.enums import (
    AiDataForm,
    AiDataSourceType,
    AiDestinationCategory,
    AiEgressDecision,
    DataClassification,
)
from apex_forensic.domain.errors import ApexError, ValidationError
from apex_forensic.domain.models import AiAssistanceRequest
from apex_forensic.domain.models.ai_governance import AiEgressData
from apex_forensic.domain.services.ai_projection import ai_data_reference

from .ai_content import excerpt

_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
SERVER_PROVIDER_ID = "apex-server"
# Stands in until the server's answer names the model that actually ran.
SERVER_MODEL_PLACEHOLDER = "apex-server"
# Outlast the server's own upstream wait (90 s by default), or a slow answer is billed and lost.
SERVER_TIMEOUT_FLOOR = 100.0


@dataclass(frozen=True)
class ServerAiSettings:
    """AI through the signed-in APEX server. Secret-free: the token arrives per request."""

    timeout: float
    max_output: int
    temperature: float

    def provider_config(self, base_url: str) -> OpenAICompatibleConfig:
        return OpenAICompatibleConfig(
            provider_id=SERVER_PROVIDER_ID,
            base_url=base_url,
            model=SERVER_MODEL_PLACEHOLDER,
            api_key_env="",
            timeout=self.timeout,
            max_output=self.max_output,
            temperature=self.temperature,
            request_policy="SELECTED_CONTEXT_ONLY",
        )


def desktop_settings() -> OpenAICompatibleConfig | ServerAiSettings | None:
    """The AI connection named by APEX_DESKTOP_AI_CONFIG, or None when unset."""
    raw = os.environ.get("APEX_DESKTOP_AI_CONFIG")
    if not raw:
        return None
    try:
        data = json.loads(raw)
        if isinstance(data, dict) and data.get("connection") == "APEX_SERVER":
            # Reuse the custom-endpoint range checks for the shared parameters.
            checked = AiProviderRuntimeConfig(
                provider_id=SERVER_PROVIDER_ID,
                base_url="https://apex.invalid",
                model_id=SERVER_MODEL_PLACEHOLDER,
                api_key_env="UNUSED",
                timeout=float(data["timeout"]),
                max_output=int(data["max_output"]),
                temperature=float(data["temperature"]),
            ).validate()
            settings = ServerAiSettings(
                timeout=max(checked.timeout, SERVER_TIMEOUT_FLOOR),
                max_output=checked.max_output,
                temperature=checked.temperature,
            )
            return settings
        config = AiProviderRuntimeConfig(**data).validate()
    except (TypeError, ValueError, AttributeError, KeyError, ValidationError) as error:
        raise ValidationError("Invalid desktop AI configuration.") from error
    return OpenAICompatibleConfig(
        provider_id=config.provider_id,
        base_url=config.base_url,
        model=config.model_id,
        api_key_env=config.api_key_env,
        timeout=config.timeout,
        max_output=config.max_output,
        temperature=config.temperature,
        request_policy=config.request_policy,
    )


def runtime(services: ServiceBundle) -> dict[str, Any]:
    result = services.ai.capabilities()
    result["configuration_error"] = None
    result["connection"] = None
    try:
        settings = desktop_settings()
    except ValidationError:
        # Optional AI setup must not prevent the local workbench from starting.
        result["configuration_error"] = {
            "code": "AI_CONFIGURATION_INVALID",
            "source": "APEX_DESKTOP_AI_CONFIG",
        }
        return result
    if isinstance(settings, ServerAiSettings):
        # Availability depends on the app's server sign-in, which only the app knows.
        result["connection"] = "APEX_SERVER"
    elif settings is not None:
        result["connection"] = "CUSTOM"
        result["runtime_capability"] = (
            OpenAICompatibleProvider(settings).capabilities().to_schema_dict()
        )
        if result["runtime_capability"]["is_available"]:
            result["engine_capabilities"].append("RUNTIME_LLM_PROVIDER")
            result["unavailable_capabilities"].remove("RUNTIME_LLM_PROVIDER")
    return result


class GovernedDesktopProvider(OpenAICompatibleProvider):
    """Send exactly the policy-approved projection or explicitly reviewed excerpt.

    Both modes retain local citations and classify generated results as AI inference.
    """

    def __init__(
        self,
        config: OpenAICompatibleConfig,
        services: ServiceBundle,
        content: dict[str, Any] | None = None,
        api_key: str | None = None,
        server_origin: str | None = None,
    ) -> None:
        self.services = services
        self.server_origin = server_origin
        self.audit: Any = None
        self.projection: Any = None
        self.content = content
        self.served_model: str | None = None
        super().__init__(config, request_payload=self._approved_payload, api_key=api_key)

    def _post_json(self, body: dict[str, Any], *, cancellation_requested: bool) -> dict[str, Any]:
        response = super()._post_json(body, cancellation_requested=cancellation_requested)
        model = response.get("model")
        if isinstance(model, str):
            # The server's word goes into the evidence record: keep it printable and bounded.
            cleaned = _CONTROL.sub("", model).strip()[:256]
            if cleaned:
                self.served_model = cleaned
        return response

    def _approved_payload(self, request: AiAssistanceRequest) -> dict[str, Any]:
        if self.content is not None:
            self.audit = self.services.ai_egress.evaluate(
                AiEgressData(
                    source=ai_data_reference(request),
                    classification=DataClassification.SECRET,
                    contains_secrets=False,
                    data_form=AiDataForm.REDACTED,
                    content_fingerprint=self.content["fingerprint"],
                ),
                destination=AiDestinationCategory.EXTERNAL,
            )
            if self.audit.result.decision is not AiEgressDecision.ALLOW:
                raise ApexError("AI_EGRESS_DENIED", "error.ai_egress_denied")
            return dict(self.content["payload"])
        self.projection = self.services.ai_projections.create(
            case_id=request.case_id,
            source_id=request.assistance_request_id,
            source_type=AiDataSourceType.AI_ASSISTANCE_REQUEST,
            classification=DataClassification.SENSITIVE,
            # Free text can contain unknown secrets. Projection removes that text,
            # while the original SECRET classification remains unchanged.
            contains_secrets=True,
        )
        # Conservatively treat every configured endpoint as external, including
        # localhost proxies that may forward requests to an external model.
        self.audit = self.services.ai_egress.evaluate_projection(
            self.projection,
            destination=AiDestinationCategory.EXTERNAL,
        )
        if self.audit.result.decision is not AiEgressDecision.ALLOW:
            raise ApexError("AI_EGRESS_DENIED", "error.ai_egress_denied")
        return dict(self.projection.to_schema_dict())

    def generate_scope_summary(self, request: AiAssistanceRequest, **kwargs: Any) -> dict[str, Any]:
        result = super().generate_scope_summary(request, **kwargs)
        if self.model_id == SERVER_MODEL_PLACEHOLDER and self.served_model:
            # Record the model the server actually ran, not the placeholder we asked for.
            result["model_id"] = self.served_model
        result["citations"] = request.citations
        result["scope_context_id"] = request.scope_context_ids[0]
        result["referenced_resource_ids"] = []
        result.setdefault("warnings", []).append(
            {
                "code": "AI_REVIEWED_EXCERPT" if self.content else "AI_STRUCTURAL_PROJECTION_ONLY",
                "developer_message": (
                    "A locally reviewed, bounded excerpt was analyzed; this is AI inference."
                    if self.content
                    else "Only structural policy-approved fields were sent. "
                    "Local citations identify the selected sources, "
                    "not evidence text read by the model."
                ),
            }
        )
        if self.server_origin is not None:
            result["warnings"].append(
                {
                    "code": "AI_APEX_SERVER",
                    "developer_message": "Answered through the signed-in APEX server.",
                    "server_origin": self.server_origin,
                }
            )
        return result


def analyze(
    services: ServiceBundle,
    *,
    case_id: str,
    resource_type: str,
    resource_id: str,
    actor: str,
    mode: str = "STRUCTURE",
    reviewed_fingerprint: str | None = None,
    prepare_only: bool = False,
    server_connection: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Run governed AI on one selected resource.

    *server_connection* (``base_url``, ``access_token``) is supplied by the app per
    request when the APEX server connection is chosen. It is used for this call only.
    """
    resources = {
        "FILE_SYSTEM_NODE",
        "ARTIFACT",
        "TIMELINE_EVENT",
        "SEARCH_RESULT",
        "MACHINE_CANDIDATE",
    }
    if resource_type not in resources:
        raise ValidationError("Select a file or analysis result for AI assistance.")
    snapshot = services.contexts.build_from_selection(
        case_id=case_id,
        actor_id=actor,
        purpose="AI_REQUEST",
        resources={resource_type: [resource_id]},
    )
    content = (
        excerpt(services, case_id=case_id, resource_type=resource_type, resource_id=resource_id)
        if mode == "CONTENT"
        else None
    )
    request = services.ai.create_request_from_context_snapshot(
        case_id=case_id,
        context_snapshot_id=snapshot.context_snapshot_id,
        requested_operations=["SUMMARIZE_SCOPE"],
        payload_fingerprint=content["fingerprint"] if content else None,
    )
    response: dict[str, Any] = {"request": request.to_schema_dict(), "execution": None}
    if content is not None:
        response.update(preview=content, mode=mode)
        if prepare_only or reviewed_fingerprint != content["fingerprint"]:
            return {**response, "status": "REVIEW_REQUIRED"}
    elif mode != "STRUCTURE":
        raise ValidationError("Unknown AI analysis mode.")
    elif prepare_only:
        return {**response, "status": "PREPARED"}
    settings = desktop_settings()
    if settings is None:
        return {**response, "status": "CONFIGURATION_REQUIRED"}
    if isinstance(settings, ServerAiSettings):
        if server_connection is None:
            return {**response, "status": "LOGIN_REQUIRED"}
        base_url = server_connection["base_url"]
        parts = urlsplit(base_url)
        server_origin = f"{parts.scheme}://{parts.netloc}"
        response["server_origin"] = server_origin
        provider = GovernedDesktopProvider(
            settings.provider_config(base_url),
            services,
            content=content,
            api_key=server_connection["access_token"],
            server_origin=server_origin,
        )
    else:
        provider = GovernedDesktopProvider(settings, services, content=content)
    try:
        execution = services.ai.execute_request(
            assistance_request_id=request.assistance_request_id,
            operation="SUMMARIZE_SCOPE",
            provider=provider,
        )
    except ApexError as error:
        if error.code != "AI_EGRESS_DENIED":
            raise
        return {**response, "status": "POLICY_DENIED", "audit": provider.audit.to_schema_dict()}
    return {
        **response,
        "status": "COMPLETED",
        "execution": execution,
        # Core may replay a saved result without calling this provider. In that
        # case there was no new egress decision or outgoing projection.
        "audit": provider.audit.to_schema_dict() if provider.audit is not None else None,
        "projection": (
            provider.projection.to_schema_dict() if provider.projection is not None else None
        ),
    }
