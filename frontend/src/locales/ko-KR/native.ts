/** Text for native dialogs opened by the Electron main process. */
export const native = {
  pickTitle: "분석할 증거 선택",
  evidenceImages: "증거 이미지",
  allFiles: "모든 파일",
  startFailedTitle: "APEX를 시작하지 못했습니다",
  startFailed: "앱을 여는 중 오류가 발생했습니다. APEX를 다시 실행해주세요.",
  userDataUnwritable: (folder: string) =>
    `APEX 데이터 폴더에 쓸 수 없습니다.\n\n${folder}\n\n이 폴더의 권한을 확인한 뒤 APEX를 다시 실행해주세요.`,
  quitBusyMessage: "분석 작업이 아직 진행 중입니다",
  quitBusyDetail:
    "지금 종료하면 진행 중인 작업이 취소되거나 중단됩니다. 증거 등록은 최대 1분까지 기다립니다.",
  quitAnyway: "종료",
  keepWorking: "계속 작업",
};
