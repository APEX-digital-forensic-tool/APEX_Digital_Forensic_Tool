const steps: [string, string, string, string, string] = [
  "언어",
  "분석자 이름",
  "AI 연결",
  "OCR·음성 인식",
  "서버 계정",
];

export const setup = {
  title: "APEX 시작 설정",
  steps,
  back: "이전",
  skip: "건너뛰기",
  next: "다음",
  start: "시작",
  progress: (n: number, total: number) => `${n} / ${total}`,
  optional: "선택 사항입니다. 나중에 설정에서 바꿀 수 있습니다.",
  accountNote: "로그인은 앱을 끌 때까지만 유지됩니다.",
  machineNote: "기본값으로 바로 쓸 수 있습니다.",
  ai: {
    title: "AI 연결",
    baseUrl: "접속 주소",
    model: "모델 이름",
    apiKey: "API 키",
    keepKey: "비워 두면 저장된 키를 유지합니다.",
    advanced: "고급 설정",
    temperature: "Temperature",
    maxOutput: "최대 출력 토큰",
    timeout: "제한 시간 (초)",
    save: "저장",
    remove: "연결 삭제",
    configured: "설정됨",
    notConfigured: "설정 안 됨",
    managed:
      "환경변수(APEX_DESKTOP_AI_CONFIG)로 관리되는 설정입니다. 실행 환경에서 변경해주세요.",
    storageUnavailable:
      "이 컴퓨터에서는 키를 암호화할 수 없어 앱에 저장하지 않습니다.",
    restartNote: "저장하면 분석 엔진을 다시 시작합니다.",
    busy: "분석 작업이 끝난 뒤 변경할 수 있습니다.",
    policyNote: "무엇을 AI로 보낼지는 사건별 AI 데이터 정책이 결정합니다.",
  },
  examiner: {
    label: "분석자 이름",
    hint: "새 사건을 만들 때 미리 채워집니다. 사건마다 바꿀 수 있습니다.",
  },
};
