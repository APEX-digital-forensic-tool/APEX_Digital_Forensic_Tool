# macOS Developer ID 서명·Apple 공증 배포

## 현재 상태와 범위

v0.1.4는 명시적 ad-hoc 서명과 DMG·ZIP 실기동 검사를 적용한 인증서 없는 프리뷰다. Developer ID 서명이나 Apple 공증을 받은 버전은 아니다. 이 문서는 향후 Apple 인증서를 준비한 뒤 수행할 별도 배포 절차다. **Apple 인증서를 등록하고 `Signed desktop release`가 성공하기 전에는 Developer ID·공증 배포가 완료된 것이 아니다.**

`Desktop Windows and macOS` PR CI와 `.github/workflows/desktop-preview-release.yml`은 Apple 자격 증명 없이 ad-hoc 프리뷰를 검증·배포한다. Developer ID·공증 배포는 별도 `.github/workflows/desktop-release.yml`을 main에서 수동 실행한다. fork/PR 코드에는 Apple 비밀값을 제공하지 않는다.

분석 엔진·로컬 API·사용자 데이터 형식과 앱 ID `org.apex.forensic`은 유지한다. Windows 설치 파일은 기존과 같은 **서명 없는 프리뷰**다. Windows 인증서와 자동 업데이트는 이 변경에 포함되지 않는다.

## 관리자가 한 번 준비할 것

유효한 Apple Developer Program 계정과 **Developer ID Application 인증서 + 해당 개인 키**가 필요하다. App Store 배포용 인증서나 Apple Development 인증서, 임시 ad-hoc 서명은 대체물이 아니다.

저장소 Settings → Secrets and variables → Actions → Repository secrets에 다음을 등록한다. 개인 키·인증서 비밀번호를 대화창, 코드, 이슈, PR에 붙이지 않는다.

| Secret 이름 | 값과 준비 방법 |
| --- | --- |
| `MAC_CSC_LINK` | Mac 키체인에서 인증서와 개인 키를 함께 내보낸 `.p12` 파일의 Base64 문자열. 개인 키가 없는 `.cer`만으로는 서명할 수 없다. |
| `MAC_CSC_KEY_PASSWORD` | 위 `.p12`를 내보낼 때 설정한 비밀번호. 이 절차에서는 빈 비밀번호를 허용하지 않는다. |
| `APPLE_API_KEY_BASE64` | App Store Connect에서 발급한 팀 API 키의 `.p8` 파일을 Base64로 인코딩한 문자열. 공증 권한이 있는 키를 사용한다. |
| `APPLE_API_KEY_ID` | 해당 API 키의 Key ID. |
| `APPLE_API_ISSUER` | 해당 팀 API 키의 Issuer ID. |
| `APPLE_TEAM_ID` | Developer ID 인증서를 발급한 팀의 10자리 Team ID. 서명 검증에서도 동일 팀인지 검사한다. |

Mac에서 파일 내용을 화면에 출력하지 않고 클립보드로 복사하는 예:

```bash
base64 -i /path/to/DeveloperID.p12 | tr -d '\n' | pbcopy
base64 -i /path/to/AuthKey_KEYID.p8 | tr -d '\n' | pbcopy
```

두 명령은 각각 실행한 직후 해당 Secret에 붙여 넣는다. 두 번째 명령은 첫 번째 클립보드 내용을 덮어쓴다. 키의 보관·폐기·갱신은 팀 계정 관리자가 담당한다. 유료 계정 가입과 인증서 발급은 코드 변경으로 대신할 수 없다.

## 빌드와 게시 과정

1. PR의 일반 Windows/macOS CI가 통과하면 main에 병합한다.
2. `frontend/package.json`과 lockfile 버전이 같고 해당 태그가 아직 없는지 확인한다. 공개한 프리뷰의 `v0.1.4` 태그는 재사용하지 않고, 다음 미사용 버전을 준비한다.
3. Actions → **Signed desktop release** → Run workflow → **main**을 선택한다.
4. 사전 검사에서 Secret 존재와 버전·중복 태그를 검사한다. 값은 출력하지 않는다. 누락되면 빌드를 중단한다.
5. Windows x64, macOS arm64, macOS x64에서 각각 테스트·정적 검사·PyInstaller 런타임 기동 검사를 진행한다.
6. Mac은 임시 `.p8` 파일을 runner 임시 폴더에 권한 `0600`으로 만든다. electron-builder 26을 사용해 Electron 앱, 하위 실행 파일, `Contents/Resources/runtime`의 Python·OCR/STT 네이티브 파일을 함께 Developer ID로 서명한다. Hardened Runtime과 secure timestamp를 검증한다.
7. 앱을 Apple에 공증하고 티켓을 붙인다. 생성한 DMG도 별도로 공증·티켓 부착한다. ZIP 안에는 티켓이 붙은 앱이 들어간다. ZIP 파일 자체는 stapling 대상이 아니다.
8. 실제 ZIP을 풀고 DMG를 읽기 전용 마운트해 내부 앱의 서명·Team ID·버전·아키텍처·티켓과 Gatekeeper 평가를 확인한다. ZIP에서 꺼낸 **서명된 분석 엔진**으로 기존 런타임 smoke test를 다시 실행한다.
9. 검증 후 해시를 기록한다. 게시 단계가 동일 commit/run의 두 Mac 검증 보고서와 파일 해시를 다시 확인한다. 파일 누락·변조·다른 run의 보고서·예상하지 않은 파일이 있으면 게시하지 않는다.
10. 모든 플랫폼이 통과한 경우에만 체크섬·빌드 출처·검증 보고서를 첨부한 GitHub prerelease를 만든다. 업로드 중에는 draft이며 업로드 완료 후 공개한다. 기존 릴리스/태그는 덮어쓰지 않는다.

Apple key 파일은 성공/실패와 관계없이 후속 정리 단계에서 삭제한다. 인증서는 electron-builder의 임시 키체인에서 처리한다. 빌드 산출물에는 개인 키를 포함하지 않는다.

## 로컬 Mac 빌드

`npm run dist:mac:release`만 실행하면 앱 공증/패키징까지다. **공개 배포 전에는 반드시 `tools/verify_macos_release.py`도 실행해야 한다.** 공개 게시는 위 workflow의 검증을 거친 산출물로 한다.

```bash
# 기존 docs/desktop/README.md 절차대로 native Python 런타임을 먼저 빌드한다.
# 환경에 CSC_LINK, CSC_KEY_PASSWORD, APPLE_API_KEY(.p8 실제 파일 경로),
# APPLE_API_KEY_ID, APPLE_API_ISSUER, APPLE_TEAM_ID를 준비한다.
cd frontend
npm ci
npm run dist:mac:release
cd ..
uv run --no-sync python tools/verify_macos_release.py
```

`CSC_IDENTITY_AUTO_DISCOVERY=false` 또는 `CSC_NAME=-`인 release 빌드는 거절한다. Developer ID 인증서 없는 ad-hoc 프리뷰 패키지는 `CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac`을 사용한다. Gatekeeper 비활성화나 quarantine 속성 삭제로 릴리스 검증을 대체하지 않는다.

## 실패 시 처리

| 실패 | 처리 |
| --- | --- |
| Missing repository secrets | 위 여섯 Secret을 설정한다. 공개 릴리스는 생성되지 않는다. |
| Developer ID identity 없음 | `.p12`에 개인 키가 포함되는지, 인증서 종류/유효기간/비밀번호를 확인한다. |
| Apple 공증 거절/timeout | Actions와 notary submission ID로 Apple 로그를 확인한다. 인증 권한, 유효한 계약, 중첩 바이너리 서명 문제 등을 해결한 뒤 재실행한다. timeout을 성공으로 간주하지 않는다. |
| signed runtime smoke 실패 | 서명된 Python/확장 모듈의 로딩·권한 문제를 조사한다. 라이브러리 검증을 전역 해제해 우회하지 않는다. |
| 태그/릴리스 존재 | 기존 공개 파일을 수정하지 않고 다음 버전을 준비한다. 업로드 단계만 실패하여 draft가 남았다면 draft 상태와 자산을 직접 확인하고 복구한다. |

서명/공증 CI 성공도 모든 Mac의 모든 포렌식 시나리오 검증을 뜻하지 않는다. 릴리스 후에는 별도 Mac에서 내려받은 설치 파일로 최초 실행, 사건 생성, 증거 등록, 분석, 보고서 흐름을 확인한다. M4 Pro는 arm64 파일을 사용한다.

## 공식 참고 자료

- [Apple: Developer ID](https://developer.apple.com/developer-id/)
- [Apple: macOS 소프트웨어 공증](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [electron-builder v26 공증](https://www.electron.build/v26/docs/features/code-signing/notarization/)
- [electron-builder v26 Mac 설정](https://www.electron.build/v26/docs/mac/)

현재 lockfile은 electron-builder `26.15.3`이다. v27의 `mac.sign` 구조를 그대로 복사하면 이 버전과 맞지 않으므로 업그레이드 시 설정과 검증을 함께 점검한다.
