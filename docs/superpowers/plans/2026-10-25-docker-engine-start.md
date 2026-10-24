# Docker Desktop 시작 추가

사용자 요청: 엔진에 연결되지 않는 화면에서 Docker 엔진을 켤 수 있는 기능.

기존 관계도 설계의 엔진 시작 제외 범위를 이 요청에 따라 확장한다. 설치/업데이트/원격 엔진 시작/모드 전환은 제외한다.

- [x] 설치된 CLI의 `docker desktop start --help`와 공식 문서로 지원 명령 확인.
- [x] Windows의 알려진 Docker Desktop 로컬 named pipe에만 시작 기능 제공. context 이름만으로 로컬 여부를 판단하지 않는다.
- [x] Rust 명령에서 context의 실제 endpoint를 다시 확인하고 중복 실행을 잠근다. Desktop 시작 후 선택한 context의 info 응답을 확인한다.
- [x] UI에 Docker 켜기 / 시작 중 상태, 실패 메시지, 완료 후 자동 새로고침 추가. 오류 원문은 접는다.
- [x] 모의 UI로 로컬 시작, 원격 버튼 숨김, 시작 실패 및 기존 Docker 동작 검증. Rust로 endpoint 허용 범위 검증.

명령: `docker desktop start --timeout 90`. 설치된 Docker Desktop을 시작하므로 엔진 자체를 앱에 내장하는 기능은 아니다.

검증 중 실제 Docker Desktop은 시작하지 않는다. 실제 기동은 사용자가 앱의 버튼을 눌렀을 때 수행된다.

참고: https://docs.docker.com/reference/cli/docker/desktop/start/
