# Redis 흐름 이벤트 연결

앱은 업무 큐를 소비하지 않는다. 별도의 관측용 Redis Stream을 읽고, 서비스가 발행한 이벤트를 큐·캐시 흐름 화면에 반영한다. BullMQ 내부 키 구조나 성공 상태를 자동 추정하지 않는다.

## 서비스 이벤트

서비스와 동일한 Redis DB에 관측 Stream을 지정한다. 서비스가 실제 동작을 확인한 뒤 `XADD`로 이벤트를 보낸다. 보존 기간·MAXLEN·쓰기 권한은 서비스에서 관리한다. 관측 앱은 Stream을 만들거나 쓰지 않는다. 아래 예시는 서비스 측 연동 코드이며 앱이 실행하는 코드가 아니다.

```js
// node-redis를 사용하는 서비스 코드 예시. 이벤트 전송 실패는 별도 집계한다.
// key에는 실제 업무 큐/캐시 키를 넣고 eventId는 재전송에도 같은 값을 사용한다.
async function observe(redis, { eventId, key, kind, ...details }) {
  await redis.xAdd('observability:redis-flow', '*', {
    event: JSON.stringify({
      eventId, sourceId: 'email-worker:instance-1',
      occurredAt: Date.now(), keyBase64: Buffer.from(key).toString('base64'),
      kind, ...details,
    }),
  });
}
await observe(redis, {
  eventId: 'job-104-attempt-1-dequeued', key: 'queue:email', kind: 'dequeue',
  jobId: '104', attemptId: '1', consumer: 'worker-1', label: '이메일 발송',
});
```

Stream 필드를 평면 문자열로 보내거나 `event` 필드에 JSON 객체를 보낼 수 있다. `event`가 있으면 해당 객체를 사용한다.

| 필드 | 계약 |
| --- | --- |
| eventId | 중복 제거용 ID, 생략 시 Redis Stream ID. 512자 이하 |
| sourceId | 필수, 서비스/인스턴스 식별자. 512자 이하 |
| occurredAt | 필수, Unix milliseconds. `at` 별칭 지원. 과도한 미래 시각은 거부 |
| keyBase64 | 필수, 실제 업무 키의 원시 바이트를 Base64로 인코딩. 현재 UI 이벤트 파서는 16,384자까지 지원 |
| kind | `enqueue`, `dequeue`, `completed`, `failed`, `retry`, `hit`, `miss`, `write`, `created`, `deleted`, `expired`, `ttl` |
| sourceSequence | 선택, 출처 내 단조 증가하는 정수 문자열 또는 Stream ID. 큰 정수는 문자열로 보존. `sequence` 별칭 지원 |
| jobId / attemptId | 선택, 작업과 시도를 구분. 각각 512자 이하 |
| group / consumer | 선택, 확인된 소비자 그룹/워커. 각각 512자 이하 |
| label | 선택, 민감 정보 없는 요약. 2,048자 이하 |

`completed`는 업무 성공을 확인했을 때만 발행한다. Stream ACK나 List POP를 성공으로 치환하지 않는다. 동일 값 쓰기는 `write`, 실제 변경 확인은 `changed`로 구분할 수 있다. 조회·적중·실패는 캐시 래퍼에서 계측하며 이 관측 앱의 읽기는 포함하지 않는다. JSON payload 전체는 이벤트에 넣지 않는다. 이벤트의 원시 임의 필드는 UI에서 폐기한다.

이벤트 Stream은 프로필/DB 범위에 귀속된다. 여러 서비스가 부분적으로 연결된 경우 전체 사용량으로 해석하지 않는다. `sampling/coverage`의 자동 적중률 계산은 현재 제공하지 않는다. 관측 전송의 내구성은 서비스의 발행 방식에 달려 있으며 업무 동작과 XADD가 원자적이라는 보장은 없다.

## 읽기 IPC

`redis_flow_events({ request, afterId })`

- `request`는 기존 ReadRequest이고 `keyBase64`는 관측 Stream 키다.
- `afterId: null`: 현재 마지막 ID로 기준선을 설정한다. 과거 항목을 재생하지 않는다.
- 다음 호출에는 응답의 `lastId`를 전달한다. 한 번에 최대 100개를 읽는다.
- 응답: `{ records: [{ id, fields }], lastId, gap, observedAt, baseline }`.
- XRANGE/XREVRANGE만 사용한다. XREADGROUP, POP, XACK, CLAIM을 호출하지 않는다.
- 기존 요청 취소, 세션 종료, 10초 제한, RESP bulk 64KiB/응답 1MiB와 IPC 2MiB 제한을 유지한다.
- 이전 커서 엔트리가 사라졌거나 현재 마지막 ID가 이전 커서보다 작으면 `gap`이다. 재생성된 Stream은 앞에서 다시 읽으며 소비자는 중복을 제거한다.
- 첫 기준선이 빈 Stream인 경우와 삭제 후 ID가 이전보다 커진 재생성 등은 완전한 유실 판정이 불가능하다. `gap:false`는 완전한 전달 보장이 아니다. sourceSequence를 함께 사용한다.
- 재연결은 새 기준선을 만들고 UI에 관측 공백을 표시한다.

## 선택적 Keyevent 알림

- `redis_notifications_start({sessionId})` → `{subscriptionId,configuration,coverage}`.
- `redis_notifications_poll({sessionId,subscriptionId})` → `{records:[{id,keyBase64,operation,observedAt}],gap,connected,error,observedAt}`.
- `redis_notifications_stop({sessionId,subscriptionId})` → null.

세션당 별도의 Pub/Sub 연결 하나가 `__keyevent@<db>__:*`를 구독한다. 고정된 `CONFIG GET notify-keyspace-events`로 설정을 확인하며 설정을 변경하지 않는다. `E` 플래그가 없으면 시작을 거부한다. CONFIG 조회가 ACL로 차단되면 `configuration:null`, `coverage:"unknown"`이며 구독 권한 자체는 별도로 확인한다. 설정 조회 성공 시 `coverage:"keyevent"`와 실제 플래그를 반환하므로 해당 플래그가 제공하는 작업만 관측 가능하다.

알림은 job 개수/ID/payload/업무 성공을 포함하지 않는다. 알림 한 건을 job 하나로 세지 않는다. DB 전체 알림을 받으므로 UI가 관측 대상 키로 필터링한다. 최대 512건 또는 약 512KiB 버퍼에서 오래된 항목부터 버리고 `gap:true`를 보고한다. Pub/Sub은 내구성이 없으며 연결이 끊기면 자동 복구하지 않는다. `connected:false`를 받으면 공백을 표시하고 새 구독과 스냅샷으로 재동기화한다.

중지, 프로필 연결 해제, 앱 종료 시 소켓을 정리한다. 폴링 없이 30초가 지나도 소켓을 닫는다. UI는 숨김/중지 시 stop을 호출하고 활성 상태에서는 30초 이내에 poll해야 한다.

## 검증

Rust 단위/모의 TCP 테스트에 Stream ID 보존, 기준선, trim 공백, 읽기 전용 명령, binary key 알림, 버퍼 상한 및 연결 해제 정리를 포함했다. `live_flow_observation_transport`는 명시한 격리 Redis에서만 실행하는 ignored 테스트다.

```powershell
$env:WOOJOO_FLOW_TEST_PORT = '16388'
cargo test --manifest-path src-tauri/Cargo.toml live_flow_observation_transport -- --ignored --nocapture
```

격리 Redis는 keyevent 알림이 켜져 있어야 한다. 테스트는 UUID 키로 관측용 Stream을 쓰고 trim한다. 105개 이벤트의 100+5 페이징, 알림 수신, trim 공백과 읽기 후 Stream 보존을 검사한다. 운영 Redis를 대상으로 실행하지 않는다.


## 화면에서 사용

1. Redis 연결 후 `캐시` 또는 `큐`의 `흐름`을 선택한다. 큐는 저장한 List/Stream 보기를 선택한다.
2. `관측 시작`으로 읽기를 시작한다. 캐시는 최소 5초 간격으로 값 최대 12개를 순환 조회하고, 현재 패턴의 키 탐색은 15초마다 한 배치씩 진행한다. 큐는 기본 2초 간격이다.
3. 톱니바퀴의 `관측용 Stream`에 위 공통 이벤트를 발행하는 키를 입력하고 `적용`한다. 앱이 이벤트를 쓰거나 업무 큐에서 항목을 소비하지 않는다.
4. 필요할 때 `키 변경 알림`을 켠다. 서버 설정/권한이 허용하는 알림만 관측되며 설정 오류는 화면에 표시한다.
5. 노드 클릭으로 값과 최근 이벤트를 보고, `이벤트 이력`에서 출처와 지연 도착을 확인한다. 목록으로 전환했다 돌아와도 같은 관측 범위의 화면과 이력을 유지한다.

캐시 TTL은 남은 시간으로 표시하되 자연 감소를 갱신 효과로 만들지 않는다. `변화 미관측`은 보관된 관측 이력에서 변화가 발견되지 않은 키만 거른다. 이를 미사용 키 판정이나 전체 서비스 접근 횟수로 해석하지 않는다. 제한된 값 미리보기의 변경은 전체 값 비교와 구별된다.

실제 캐시 hit/miss와 job 처리 결과는 서비스 이벤트가 있어야 표시된다. 서비스 연동 전에도 스냅샷의 길이·값·TTL 변화는 확인할 수 있지만, List 길이 감소를 특정 job의 성공으로 바꾸지 않는다. Stream 원본은 ACK 이후에도 남을 수 있으므로 업무 이벤트 토큰과 원본 조회 카드를 별도로 표현한다.

`데모 살펴보기`에서는 job 유입/인출과 캐시 조회/갱신을 직접 재현할 수 있다. 데모 조작은 Redis 명령을 발행하지 않는다. 실제 화면 증빙은 `artifacts/redis-flow-*.png`, UI/IPC 검증은 `tests/redis-flow.spec.ts` 및 `tests/redis-native-contract.spec.ts`에 있다.
