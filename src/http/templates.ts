import { blankSpec, paramsFromUrl, type Pair, type RequestSpec } from './model';

/** Ready-made API collections. Each one also creates its own environment, filled in step by step. */
type Text = { ko: string; en: string };
export type TemplateField = {
  key: string; label: Text; placeholder?: string; value?: string;
  /** Blank values are allowed; the request that needs it will show the variable as missing. */
  required?: boolean; secret?: boolean;
  /** Test values only: a value matching this looks like a live key. */
  live?: RegExp;
};
/** A request the dialog can send to fill a field, e.g. an OAuth access token. */
export type TemplateFetch = { label: Text; request: RequestSpec; pick: string; into: string };
export type TemplateStep = { title: Text; body: Text; link?: { label: Text; url: string }; fields?: TemplateField[]; fetch?: TemplateFetch };
export type TemplateRequest = { name: string; note: Text; spec: RequestSpec };
export type ApiTemplate = {
  id: string; name: string; summary: Text; environment: string; docs: string;
  steps: TemplateStep[]; requests: TemplateRequest[];
  /** Created blank in the environment for requests used later, e.g. billing. */
  later?: string[];
};

const pairs = (entries: Record<string, string>): Pair[] => Object.entries(entries).map(([key, value]) => ({ key, value, enabled: true }));
function request(method: string, url: string, patch: Partial<RequestSpec> = {}): RequestSpec {
  const spec = blankSpec();
  return { ...spec, method, url, params: paramsFromUrl(url, []), ...patch, body: { ...spec.body, ...patch.body }, auth: { ...spec.auth, ...patch.auth } };
}
const json = (value: unknown) => ({ kind: 'json' as const, text: value === '' ? '' : JSON.stringify(value, null, 2), form: [] });
const form = (entries: Record<string, string>) => ({ kind: 'form' as const, text: '', form: pairs(entries) });

// --- Toss Payments --------------------------------------------------------------
const toss = { kind: 'basic' as const, username: '{{tossSecretKey}}', password: '' };
const tossTemplate: ApiTemplate = {
  id: 'tosspayments', name: '토스페이먼츠', later: ['tossCustomerKey', 'tossAuthKey', 'tossBillingKey'], environment: '토스페이먼츠 (테스트)', docs: 'https://docs.tosspayments.com/reference',
  summary: { ko: '결제 승인·조회·취소, 가상계좌 발급, 빌링(자동결제)', en: 'Confirm, look up and cancel payments, virtual accounts, billing' },
  steps: [
    {
      title: { ko: '개발자센터에 로그인', en: 'Sign in to the developer center' },
      body: { ko: '토스페이먼츠 개발자센터에 가입하고 로그인하세요. 사업자 등록 없이도 테스트 키를 바로 받을 수 있어요.', en: 'Sign up and sign in to the Toss Payments developer center. Test keys are available without a business registration.' },
      link: { label: { ko: '개발자센터 열기', en: 'Open the developer center' }, url: 'https://developers.tosspayments.com' },
    },
    {
      title: { ko: '테스트 시크릿 키 복사', en: 'Copy the test secret key' },
      body: { ko: '상단의 [내 개발정보] → [API 키]에서 "테스트" 탭의 시크릿 키를 복사해 붙여 넣으세요. test_sk_ 또는 test_gsk_로 시작해요. 클라이언트 키(test_ck_)가 아니라 시크릿 키예요.', en: 'Open My developer info → API keys and copy the secret key on the Test tab. It starts with test_sk_ or test_gsk_ — not the client key (test_ck_).' },
      link: { label: { ko: 'API 키 메뉴 설명', en: 'About API keys' }, url: 'https://docs.tosspayments.com/reference/using-api/api-keys' },
      fields: [{ key: 'tossSecretKey', label: { ko: '테스트 시크릿 키', en: 'Test secret key' }, placeholder: 'test_sk_…', required: true, secret: true, live: /^live_/ }],
    },
    {
      title: { ko: '(선택) 결제 정보 채우기', en: '(Optional) Fill in a payment' },
      body: { ko: '결제창에서 테스트 결제를 마치면 successUrl에 paymentKey, orderId가 붙어 돌아와요. 그 값을 넣으면 승인·조회·취소 요청을 바로 보낼 수 있어요. 지금은 비워 두고 나중에 [환경 변수]에서 채워도 돼요. 결제창 없이 해 보려면 "가상계좌 발급" 요청을 먼저 보내 보세요.', en: 'After a test checkout, successUrl receives paymentKey and orderId. Fill them in to confirm, look up and cancel. You can leave them blank and fill them later under Environments, or try "Issue virtual account", which needs no checkout.' },
      fields: [
        { key: 'tossPaymentKey', label: { ko: 'paymentKey', en: 'paymentKey' }, placeholder: 'tgen_…' },
        { key: 'tossOrderId', label: { ko: 'orderId', en: 'orderId' }, placeholder: 'order-…' },
        { key: 'tossAmount', label: { ko: '결제 금액', en: 'Amount' }, value: '50000' },
      ],
    },
  ],
  requests: [
    { name: '결제 승인', note: { ko: '결제창 인증 후 최종 승인', en: 'Confirms a payment after checkout' }, spec: request('POST', '{{tossBaseUrl}}/v1/payments/confirm', { auth: toss as RequestSpec['auth'], body: { kind: 'json', text: '{\n  "paymentKey": "{{tossPaymentKey}}",\n  "orderId": "{{tossOrderId}}",\n  "amount": {{tossAmount}}\n}', form: [] } }) },
    { name: 'paymentKey로 결제 조회', note: { ko: '결제 상세 조회', en: 'Looks up a payment' }, spec: request('GET', '{{tossBaseUrl}}/v1/payments/{{tossPaymentKey}}', { auth: toss as RequestSpec['auth'] }) },
    { name: 'orderId로 결제 조회', note: { ko: '주문 번호로 조회', en: 'Looks up by order ID' }, spec: request('GET', '{{tossBaseUrl}}/v1/payments/orders/{{tossOrderId}}', { auth: toss as RequestSpec['auth'] }) },
    { name: '결제 취소', note: { ko: '전액 취소 (부분 취소는 cancelAmount 추가)', en: 'Full cancel (add cancelAmount for partial)' }, spec: request('POST', '{{tossBaseUrl}}/v1/payments/{{tossPaymentKey}}/cancel', { auth: toss as RequestSpec['auth'], headers: pairs({ 'Idempotency-Key': '{{$uuid}}' }), body: json({ cancelReason: '고객 변심' }) }) },
    { name: '가상계좌 발급', note: { ko: '결제창 없이 바로 보낼 수 있어요', en: 'Works without a checkout' }, spec: request('POST', '{{tossBaseUrl}}/v1/virtual-accounts', { auth: toss as RequestSpec['auth'], body: json({ amount: 50000, orderId: 'order-{{$timestamp}}', orderName: '테스트 주문', customerName: '홍길동', bank: '20', validHours: 24 }) }) },
    { name: '빌링키 발급', note: { ko: '자동결제 등록 후 받은 authKey로 발급', en: 'Issues a billing key from an authKey' }, spec: request('POST', '{{tossBaseUrl}}/v1/billing/authorizations/issue', { auth: toss as RequestSpec['auth'], body: json({ authKey: '{{tossAuthKey}}', customerKey: '{{tossCustomerKey}}' }) }) },
    { name: '빌링키로 자동결제', note: { ko: '발급한 빌링키로 결제 승인', en: 'Charges a billing key' }, spec: request('POST', '{{tossBaseUrl}}/v1/billing/{{tossBillingKey}}', { auth: toss as RequestSpec['auth'], body: json({ customerKey: '{{tossCustomerKey}}', amount: 4900, orderId: 'order-{{$timestamp}}', orderName: '정기 구독' }) }) },
    { name: '거래 내역 조회', note: { ko: '기간별 거래 목록', en: 'Transactions in a period' }, spec: request('GET', '{{tossBaseUrl}}/v1/transactions?startDate=2026-01-01T00:00:00&endDate=2026-12-31T23:59:59', { auth: toss as RequestSpec['auth'] }) },
  ],
};

// --- Stripe ---------------------------------------------------------------------
const stripe = { kind: 'bearer' as const, token: '{{stripeSecretKey}}' };
const stripeTemplate: ApiTemplate = {
  id: 'stripe', name: 'Stripe', environment: 'Stripe (Test mode)', docs: 'https://docs.stripe.com/api',
  summary: { ko: '잔액, 고객, PaymentIntent, 환불, Checkout 세션', en: 'Balance, customers, PaymentIntents, refunds, Checkout Sessions' },
  steps: [
    {
      title: { ko: 'Stripe 계정 만들기', en: 'Create a Stripe account' },
      body: { ko: 'Stripe에 가입하세요. 테스트 모드는 사업자 인증 없이 바로 쓸 수 있어요.', en: 'Sign up for Stripe. Test mode works right away without business verification.' },
      link: { label: { ko: 'Stripe 가입', en: 'Sign up' }, url: 'https://dashboard.stripe.com/register' },
    },
    {
      title: { ko: '테스트 시크릿 키 복사', en: 'Copy the test secret key' },
      body: { ko: '대시보드 오른쪽 위가 "테스트 모드(또는 샌드박스)"인지 확인하고, [Developers] → [API keys]에서 Secret key의 [Reveal test key]를 눌러 복사하세요. sk_test_로 시작해요.', en: 'Make sure the dashboard is in test mode (or a sandbox), then open Developers → API keys and click Reveal test key. It starts with sk_test_.' },
      link: { label: { ko: 'API keys 열기', en: 'Open API keys' }, url: 'https://dashboard.stripe.com/test/apikeys' },
      fields: [{ key: 'stripeSecretKey', label: { ko: '테스트 시크릿 키', en: 'Test secret key' }, placeholder: 'sk_test_…', required: true, secret: true, live: /^(sk|rk)_live_/ }],
    },
    {
      title: { ko: '이렇게 테스트해 보세요', en: 'Try it' },
      body: { ko: '"잔액 조회"로 키가 맞는지 먼저 확인하세요. "PaymentIntent 생성"은 테스트 카드(pm_card_visa)로 바로 결제까지 끝내요. 응답의 id(pi_…)를 아래에 넣으면 조회·환불 요청에 쓰여요.', en: 'Send "Retrieve balance" first to check the key. "Create PaymentIntent" pays immediately with the test card pm_card_visa. Put the returned id (pi_…) below for the look-up and refund requests.' },
      link: { label: { ko: '테스트 카드 목록', en: 'Test cards' }, url: 'https://docs.stripe.com/testing' },
      fields: [{ key: 'stripePaymentIntentId', label: { ko: 'PaymentIntent ID', en: 'PaymentIntent ID' }, placeholder: 'pi_…' }],
    },
  ],
  requests: [
    { name: '잔액 조회', note: { ko: '키 확인용으로 가장 간단해요', en: 'The simplest key check' }, spec: request('GET', '{{stripeBaseUrl}}/v1/balance', { auth: stripe as RequestSpec['auth'] }) },
    { name: '고객 생성', note: { ko: 'Customer 만들기', en: 'Creates a customer' }, spec: request('POST', '{{stripeBaseUrl}}/v1/customers', { auth: stripe as RequestSpec['auth'], body: form({ email: 'test@example.com', name: 'Test Customer' }) }) },
    { name: '고객 목록', note: { ko: '최근 10명', en: 'Latest 10' }, spec: request('GET', '{{stripeBaseUrl}}/v1/customers?limit=10', { auth: stripe as RequestSpec['auth'], }) },
    { name: 'PaymentIntent 생성', note: { ko: '테스트 카드로 즉시 결제', en: 'Pays immediately with a test card' }, spec: request('POST', '{{stripeBaseUrl}}/v1/payment_intents', { auth: stripe as RequestSpec['auth'], headers: pairs({ 'Idempotency-Key': '{{$uuid}}' }), body: form({ amount: '2000', currency: 'usd', payment_method: 'pm_card_visa', confirm: 'true', 'automatic_payment_methods[enabled]': 'true', 'automatic_payment_methods[allow_redirects]': 'never' }) }) },
    { name: 'PaymentIntent 조회', note: { ko: 'pi_ ID로 상태 확인', en: 'Checks status by pi_ ID' }, spec: request('GET', '{{stripeBaseUrl}}/v1/payment_intents/{{stripePaymentIntentId}}', { auth: stripe as RequestSpec['auth'] }) },
    { name: '환불', note: { ko: 'PaymentIntent 전액 환불', en: 'Refunds a PaymentIntent in full' }, spec: request('POST', '{{stripeBaseUrl}}/v1/refunds', { auth: stripe as RequestSpec['auth'], headers: pairs({ 'Idempotency-Key': '{{$uuid}}' }), body: form({ payment_intent: '{{stripePaymentIntentId}}' }) }) },
    { name: 'Checkout 세션 생성', note: { ko: '응답의 url을 브라우저로 열면 결제 페이지', en: 'Open the returned url to pay' }, spec: request('POST', '{{stripeBaseUrl}}/v1/checkout/sessions', { auth: stripe as RequestSpec['auth'], body: form({ mode: 'payment', success_url: 'https://example.com/success?session_id={CHECKOUT_SESSION_ID}', 'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'usd', 'line_items[0][price_data][unit_amount]': '2000', 'line_items[0][price_data][product_data][name]': 'Test product' }) }) },
  ],
};

// --- PayPal ---------------------------------------------------------------------
const paypal = { kind: 'bearer' as const, token: '{{paypalAccessToken}}' };
const paypalToken = request('POST', '{{paypalBaseUrl}}/v1/oauth2/token', { auth: { kind: 'basic', username: '{{paypalClientId}}', password: '{{paypalClientSecret}}' } as RequestSpec['auth'], body: form({ grant_type: 'client_credentials' }) });
const paypalTemplate: ApiTemplate = {
  id: 'paypal', name: 'PayPal', environment: 'PayPal (Sandbox)', docs: 'https://developer.paypal.com/api/rest/',
  summary: { ko: '액세스 토큰, 주문 생성·조회·캡처, 환불', en: 'Access token, create, look up and capture orders, refunds' },
  steps: [
    {
      title: { ko: 'PayPal Developer에 로그인', en: 'Sign in to PayPal Developer' },
      body: { ko: 'PayPal 계정으로 개발자 대시보드에 로그인하세요. 계정이 없으면 가입부터 하세요. 샌드박스는 실제 돈이 오가지 않아요.', en: 'Sign in to the developer dashboard with a PayPal account (sign up if needed). The sandbox never moves real money.' },
      link: { label: { ko: '대시보드 열기', en: 'Open the dashboard' }, url: 'https://developer.paypal.com/dashboard/' },
    },
    {
      title: { ko: 'Client ID와 Secret 복사', en: 'Copy the Client ID and Secret' },
      body: { ko: '[Apps & Credentials]에서 위쪽 스위치가 "Sandbox"인지 확인하세요. "Default Application"(없으면 [Create App])을 열어 Client ID와 Secret key 1을 복사해 붙여 넣으세요.', en: 'In Apps & Credentials, make sure the toggle says Sandbox. Open Default Application (or Create App) and copy the Client ID and Secret key 1.' },
      link: { label: { ko: 'Apps & Credentials 열기', en: 'Open Apps & Credentials' }, url: 'https://developer.paypal.com/dashboard/applications/sandbox' },
      fields: [
        { key: 'paypalClientId', label: { ko: 'Client ID', en: 'Client ID' }, placeholder: 'A…', required: true },
        { key: 'paypalClientSecret', label: { ko: 'Secret', en: 'Secret' }, placeholder: 'E…', required: true, secret: true },
      ],
    },
    {
      title: { ko: '액세스 토큰 받기', en: 'Get an access token' },
      body: { ko: 'PayPal은 Client ID/Secret으로 액세스 토큰을 먼저 받아서 써야 해요. 아래 버튼을 누르면 토큰을 받아 자동으로 채워요. 토큰은 약 9시간 뒤 만료되니, 그때는 컬렉션의 "액세스 토큰 발급" 요청을 보내고 응답의 access_token을 [환경 변수]에 다시 넣으세요.', en: 'PayPal needs an access token from your Client ID and Secret. The button below fetches one and fills it in. Tokens expire after about 9 hours; then send "Get access token" from the collection and paste access_token under Environments.' },
      fields: [{ key: 'paypalAccessToken', label: { ko: '액세스 토큰', en: 'Access token' }, placeholder: 'A21AA…', secret: true }],
      fetch: { label: { ko: '토큰 받아 채우기', en: 'Fetch and fill token' }, request: paypalToken, pick: 'access_token', into: 'paypalAccessToken' },
    },
    {
      title: { ko: '이렇게 테스트해 보세요', en: 'Try it' },
      body: { ko: '"주문 생성"을 보내면 응답 links의 rel이 "approve"인 주소가 나와요. 그 주소를 브라우저로 열고 샌드박스 구매자 계정([Testing Tools] → [Sandbox Accounts]의 Personal 계정)으로 승인하세요. 그다음 주문 ID를 넣고 "주문 캡처"를 보내면 결제가 끝나요.', en: 'Send "Create order" and open the link whose rel is "approve". Approve with a sandbox buyer (Testing Tools → Sandbox Accounts, the Personal account). Then put the order ID here and send "Capture order".' },
      link: { label: { ko: '샌드박스 계정 보기', en: 'Sandbox accounts' }, url: 'https://developer.paypal.com/dashboard/accounts' },
      fields: [
        { key: 'paypalOrderId', label: { ko: '주문 ID', en: 'Order ID' }, placeholder: '5O190127TN364715T' },
        { key: 'paypalCaptureId', label: { ko: '캡처 ID (환불용)', en: 'Capture ID (for refunds)' }, placeholder: '3C679366HH908993F' },
      ],
    },
  ],
  requests: [
    { name: '액세스 토큰 발급', note: { ko: '응답의 access_token을 환경 변수에 넣으세요', en: 'Put access_token in the environment' }, spec: paypalToken },
    { name: '주문 생성', note: { ko: '응답의 approve 링크로 구매자 승인', en: 'Approve via the approve link' }, spec: request('POST', '{{paypalBaseUrl}}/v2/checkout/orders', { auth: paypal as RequestSpec['auth'], headers: pairs({ 'PayPal-Request-Id': '{{$uuid}}' }), body: json({ intent: 'CAPTURE', purchase_units: [{ reference_id: 'order-1', amount: { currency_code: 'USD', value: '10.00' } }] }) }) },
    { name: '주문 조회', note: { ko: '주문 상태 확인', en: 'Checks order status' }, spec: request('GET', '{{paypalBaseUrl}}/v2/checkout/orders/{{paypalOrderId}}', { auth: paypal as RequestSpec['auth'] }) },
    { name: '주문 캡처', note: { ko: '승인된 주문 결제 완료', en: 'Completes an approved order' }, spec: request('POST', '{{paypalBaseUrl}}/v2/checkout/orders/{{paypalOrderId}}/capture', { auth: paypal as RequestSpec['auth'], headers: pairs({ 'PayPal-Request-Id': '{{$uuid}}' }), body: json('') }) },
    { name: '캡처 조회', note: { ko: '결제 건 상세', en: 'Captured payment details' }, spec: request('GET', '{{paypalBaseUrl}}/v2/payments/captures/{{paypalCaptureId}}', { auth: paypal as RequestSpec['auth'] }) },
    { name: '환불', note: { ko: '캡처 전액 환불', en: 'Refunds a capture in full' }, spec: request('POST', '{{paypalBaseUrl}}/v2/payments/captures/{{paypalCaptureId}}/refund', { auth: paypal as RequestSpec['auth'], headers: pairs({ 'PayPal-Request-Id': '{{$uuid}}' }), body: json('') }) },
  ],
};

/** Base URLs live in the environment so a live environment can be added beside the test one. */
const BASE_URLS: Record<string, [string, string]> = {
  tosspayments: ['tossBaseUrl', 'https://api.tosspayments.com'],
  stripe: ['stripeBaseUrl', 'https://api.stripe.com'],
  paypal: ['paypalBaseUrl', 'https://api-m.sandbox.paypal.com'],
};
export const API_TEMPLATES: ApiTemplate[] = [tossTemplate, stripeTemplate, paypalTemplate];

export const templateFields = (template: ApiTemplate) => template.steps.flatMap(step => step.fields ?? []);
/** The environment variables a template creates, in order, with what the user typed. */
export function templateVariables(template: ApiTemplate, values: Record<string, string>): Pair[] {
  const [baseKey, baseUrl] = BASE_URLS[template.id];
  return [{ key: baseKey, value: baseUrl, enabled: true }, ...templateFields(template).map(field => ({ key: field.key, value: (values[field.key] ?? field.value ?? '').trim(), enabled: true })),
    ...(template.later ?? []).map(key => ({ key, value: '', enabled: true }))];
}
export const looksLive = (field: TemplateField, value: string) => !!field.live?.test(value.trim());
/** Reads a top-level JSON field from a response body. */
export function pickJson(body: string, key: string): string | null {
  try { const value = JSON.parse(body)?.[key]; return typeof value === 'string' && value ? value : null; } catch { return null; }
}
/** "Name", or "Name 2", "Name 3"… when the name is taken. */
export function uniqueName(name: string, taken: string[]) {
  const names = new Set(taken);
  if (!names.has(name)) return name;
  let index = 2; while (names.has(`${name} ${index}`)) index++;
  return `${name} ${index}`;
}
