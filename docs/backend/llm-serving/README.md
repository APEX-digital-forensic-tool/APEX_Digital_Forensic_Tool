# LLM 서빙

로그인한 APEX 클라이언트가 서버를 거쳐 Kimi(Moonshot)를 호출하는 경로다. Kimi 키는 서버 환경변수에만 있고 클라이언트에는 가지 않는다.

## API

`POST /llm/v1/chat/completions` (OpenAI 호환, 스트리밍 없음)

- `Authorization: Bearer <access_token>`이 필요하다. 토큰 서명뿐 아니라 서버 세션도 살아 있어야 한다. 로그아웃하면 그 토큰으로는 바로 401이 난다.
- 서버가 모델을 정한다. 클라이언트가 보낸 `model`은 무시한다. 응답의 `model`이 실제로 답한 모델이다.
- 전달하는 필드: `messages`, `temperature`, `top_p`, `max_tokens`(서버 상한으로 줄임), `response_format`, `stop`. 나머지는 버린다.
- 요청 본문 상한은 2 MiB다. `Content-Length`가 상한을 넘으면 읽기 전에 413을 돌려주고, 읽는 중에도 상한을 넘으면 멈춘다.
- 세션을 확인한 뒤 DB 연결을 바로 풀에 돌려준다. Kimi 응답을 기다리는 동안 연결을 붙잡지 않는다.
- 호출마다 `llm call actor=… session=… request_bytes=… response_bytes=… status=…`를 INFO로 남긴다. 토큰, 키, 본문은 남기지 않는다.

| 상황 | 클라이언트가 받는 상태 |
|---|---|
| 토큰 없음, 무효, 세션 만료·폐기 | 401 |
| 서버에 Kimi 키가 없음 | 503 |
| 요청 형식 오류, `stream: true` | 400 |
| 본문이 2 MiB 초과 | 413 |
| Kimi가 서버 키·잔액·모델·주소를 거부(401/402/403/404) | 502 (클라이언트 로그인 문제로 보이지 않게). 서버 로그에 error로 남긴다. |
| Kimi 429 | 429 |
| Kimi 그 밖의 4xx | 400 |
| Kimi 5xx, 연결 실패, JSON 아님 | 502 |
| Kimi 시간 초과 | 504 |

Kimi의 오류 본문은 클라이언트에 그대로 보내지 않는다.

## 서버 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `APEX_LLM_UPSTREAM_API_KEY` | 없음 | Kimi API 키. 없으면 LLM 서빙이 꺼지고 503을 돌려준다. |
| `APEX_LLM_UPSTREAM_BASE_URL` | `https://api.moonshot.ai/v1` | 중국 플랫폼은 `https://api.moonshot.cn/v1`. 두 플랫폼의 키는 서로 호환되지 않는다. |
| `APEX_LLM_MODEL` | `kimi-k3.1-pro` | Moonshot 공식 quickstart가 쓰는 모델. 다른 모델은 이 변수로 바꾼다. |
| `APEX_LLM_TIMEOUT` | `90` | Kimi 응답 전체를 기다리는 초. 연결부터 마지막 바이트까지 합친 시간이다. 넘으면 504. |
| `APEX_LLM_MAX_TOKENS` | `8192` | 요청 하나의 `max_tokens` 상한. |

앱의 'APEX 서버' AI 연결은 기본 제한 시간이 120초이고, 100초보다 짧게 설정할 수 없다. 앱의 제한 시간은 `APEX_LLM_TIMEOUT`보다 길어야 하므로 `APEX_LLM_TIMEOUT`은 100 미만으로 둔다. 앱의 제한 시간이 더 짧으면 서버가 아직 Kimi 응답을 기다리는 동안 앱이 먼저 포기하고, Kimi 호출 비용은 그대로 나간다.

기본 URL과 모델은 2026-11-17에 Moonshot 문서 검색 결과로 정했다. 실제 Kimi 키로는 아직 호출해 보지 않았다.
