// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { AccountStatus } from "../electron/serverSession";
import { createDemoBridge } from "./demoBridge";
import { AccountPanel } from "./panels";

afterEach(() => {
  cleanup();
  delete window.apex;
});

const SIGNED_IN: AccountStatus = {
  state: "signed_in",
  connected: true,
  origin: "https://apex.test",
  expires_at: Date.UTC(2026, 10, 17, 3, 30),
  reason: null,
};

function bridge(initial: AccountStatus) {
  const b = createDemoBridge();
  let push: ((s: AccountStatus) => void) | null = null;
  b.account = async () => ({ ok: true, data: initial });
  b.onAccountChange = (listener) => {
    push = listener;
    return () => {
      push = null;
    };
  };
  window.apex = b;
  return { b, push: (s: AccountStatus) => act(() => push!(s)) };
}

it("shows the signed-in server and when the session renews", async () => {
  bridge(SIGNED_IN);
  render(<AccountPanel />);
  expect(await screen.findByText("로그인됨")).toBeTruthy();
  expect(screen.getByText("https://apex.test")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toMatch(
    /전에 자동으로 갱신됩니다/,
  );
});

it("follows refresh trouble and expiry pushed from the main process", async () => {
  const { push } = bridge(SIGNED_IN);
  render(<AccountPanel />);
  await screen.findByText("로그인됨");

  push({ ...SIGNED_IN, state: "reconnecting", connected: false });
  expect(screen.getByText("다시 연결 중")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toMatch(
    /연결되면 자동으로 이어집니다/,
  );

  push({
    state: "signed_out",
    connected: false,
    origin: null,
    expires_at: null,
    reason: "SESSION_EXPIRED",
  });
  expect(screen.getByText(/세션이 만료되어 로그아웃되었습니다/)).toBeTruthy();
  expect(screen.getByRole("button", { name: /계정 연결/ })).toBeTruthy();
});

it("says when the server could not be told about the logout", async () => {
  const { b } = bridge(SIGNED_IN);
  b.logout = async () => ({
    ok: false,
    error: { code: "AUTH_LOGOUT_INCOMPLETE" },
  });
  render(<AccountPanel />);
  await screen.findByText("로그인됨");
  b.account = async () => ({
    ok: true,
    data: {
      state: "signed_out",
      connected: false,
      origin: null,
      expires_at: null,
      reason: "LOGGED_OUT",
    },
  });
  fireEvent.click(screen.getByRole("button", { name: /앱에서 로그아웃/ }));
  expect((await screen.findByRole("alert")).textContent).toMatch(
    /서버에 세션 종료를 알리지 못했습니다/,
  );
  expect(await screen.findByRole("button", { name: /계정 연결/ })).toBeTruthy();
});

it("shows the sign-in error and keeps the form", async () => {
  const { b } = bridge({
    state: "signed_out",
    connected: false,
    origin: null,
    expires_at: null,
    reason: null,
  });
  b.login = async () => ({ ok: false, error: { code: "AUTH_LOGIN_FAILED" } });
  const { container } = render(<AccountPanel />);
  const form = container.querySelector("form")!;
  for (const [name, value] of [
    ["origin", "https://apex.test"],
    ["tenant_id", "t1"],
    ["email", "a@example.com"],
    ["password", "pw"],
  ])
    fireEvent.change(form.querySelector(`[name=${name}]`)!, {
      target: { value },
    });
  fireEvent.submit(form);
  expect((await screen.findByRole("alert")).textContent).toMatch(
    /이메일, 비밀번호 또는 테넌트 ID를 확인해주세요/,
  );
  expect(container.querySelector("form")).toBeTruthy();
});

it("keeps a pushed change when the first status load answers later", async () => {
  const { b, push } = bridge(SIGNED_IN);
  let answer!: (reply: { ok: true; data: AccountStatus }) => void;
  b.account = () => new Promise((r) => (answer = r));
  render(<AccountPanel />);
  push({ ...SIGNED_IN, state: "reconnecting", connected: false });
  await act(async () => answer({ ok: true, data: SIGNED_IN }));
  expect(screen.getByText("다시 연결 중")).toBeTruthy();
});

it("keeps a pushed change when the sign-in reply answers later", async () => {
  const { b, push } = bridge({
    state: "signed_out",
    connected: false,
    origin: null,
    expires_at: null,
    reason: null,
  });
  let answer!: (reply: { ok: true; data: AccountStatus }) => void;
  b.login = () => new Promise((r) => (answer = r));
  const { container } = render(<AccountPanel />);
  await screen.findByRole("button", { name: /연결/ });
  const form = container.querySelector("form")!;
  fireEvent.submit(form);
  push({ ...SIGNED_IN, state: "reconnecting", connected: false });
  await act(async () => answer({ ok: true, data: SIGNED_IN }));
  expect(screen.getByText("다시 연결 중")).toBeTruthy();
});

it("keeps a pushed change when the logout reply answers later", async () => {
  const { b, push } = bridge(SIGNED_IN);
  let answer!: (reply: { ok: true; data: null }) => void;
  b.logout = () => new Promise((r) => (answer = r));
  render(<AccountPanel />);
  fireEvent.click(await screen.findByRole("button", { name: /로그아웃/ }));
  push({ ...SIGNED_IN, origin: "https://other.test" });
  await act(async () => answer({ ok: true, data: null }));
  expect(screen.getByText("https://other.test")).toBeTruthy();
});
