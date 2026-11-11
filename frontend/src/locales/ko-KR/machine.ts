export const machine = {
  errorReasons: {
    EMPTY: "설정 내용이 비어 있음",
    JSON_SYNTAX: "JSON 문법 오류",
    ENCODING: "UTF-8이 아닌 인코딩",
    NOT_OBJECT: "설정 형식이 객체가 아님",
    INVALID_FIELDS: "허용되지 않는 필드 또는 값",
    UNREADABLE: "파일을 읽을 수 없음",
  },
  title: "로컬 OCR·음성 인식 설정",
  privacy:
    "원본을 외부로 보내지 않습니다. 설치된 분석기와 로컬 모델을 사용합니다.",
  sttIntro:
    "STT는 녹음의 음성을 글자로 바꾸는 기능입니다. API 키가 아닌 음성 인식용 로컬 모델을 사용합니다. 설치 파일의 기본 다국어 모델로 한국어·영어를 오프라인에서 분석할 수 있습니다. 별도의 계정이나 다운로드는 필요하지 않습니다.",
  readiness: "로컬 기능 준비 상태",
  bundledLabel: "기본 STT 모델:",
  /** Shown instead of the engine's own (Korean-only) model name. */
  bundledModelName: "Whisper base · 다국어 (한국어·영어 포함)",
  noBundled: "내장 모델 없음 · 소스 실행 시 자산 준비 또는 모델 선택 필요",
  ffmpegLabel: "영상 프레임 FFmpeg:",
  ffprobeLabel: "영상·음성 정보 ffprobe:",
  ready: "준비됨",
  notReady: "준비 필요",
  dpapiLabel: "DPAPI 복호화 엔진:",
  dpapiReady: "준비됨 · 대상의 키·자격정보는 별도 필요",
  dpapiMissing: "라이브러리 준비 필요",
  managed: "환경변수로 관리되는 설정입니다. 실행 환경에서 변경해주세요.",
  settingsError: (reason: string, fields: string) =>
    `저장된 분석기 설정을 읽지 못했습니다: ${reason}${fields}. 설정을 복구하기 전까지 OCR·STT 실행은 거부됩니다.`,
  resetAction: "손상된 설정 보존 후 기본값으로 복구",
  fixEnv: "실행 환경의 APEX_DESKTOP_MACHINE_CONFIG 값을 수정해주세요.",
  preserved: (file: string) =>
    `이전 설정 파일을 ${file} 이름으로 보존했습니다. 사건·증거 데이터는 변경되지 않았습니다.`,
  legend: "분석기와 모델",
  ocr: "문자 인식",
  ocrAuto: "사용 가능한 분석기 자동 선택",
  pickTessdata: "OCR 언어 모델 폴더 선택",
  defaultTessdata: "기본 언어 모델 경로",
  stt: "음성 인식",
  pickModel: "음성 모델 선택",
  useBundled: "내장 다국어 모델 사용",
  noModel: "모델 미설정",
  fasterWhisperHelp:
    "더 큰 모델을 사용하려면 Faster Whisper/CTranslate2 모델의 전체 폴더를 선택하세요. model.bin, config.json, tokenizer.json, vocabulary 파일이 필요합니다. 한국어는 다국어 모델을 사용하세요. 이름이 .en으로 끝나는 모델은 영어 전용입니다.",
  whisperCppHelp:
    "whisper.cpp 모델 파일과 PATH에 설치된 whisper-cli 실행 파일이 필요합니다. 기본 Faster Whisper는 별도 실행 파일을 설치하지 않아도 됩니다.",
  restoreBundled: "기본 내장 모델로 복원",
  clearModel: "음성 모델 설정 해제",
  save: "분석기 설정 저장",
  sttReady: "저장된 STT 설정: 분석기와 모델 파일 준비됨",
  sttNotReady: "저장된 STT 설정: 모델 또는 분석기 준비 필요",
  runnable: "실행 가능 여부",
};
