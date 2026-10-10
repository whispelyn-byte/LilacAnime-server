# LilacAnime Server

LilacAnime 데스크톱 앱과 휴대폰 앱의 **내 목록**과 **시청 기록**(이어 보기 위치 포함)을 맞춰 주는 개인용 동기화 서버입니다. 각자 자기 Vercel 계정에 배포해서 씁니다. 데이터는 내 Vercel 프로젝트에 연결한 Upstash Redis에만 저장되고, 내가 정한 비밀번호를 아는 기기만 읽고 쓸 수 있습니다.

```
휴대폰 앱  ⇄  내 Vercel 서버 (+ Upstash Redis)  ⇄  데스크톱 앱
```

## 서버 만들기

Vercel 무료 플랜과 Upstash 무료 한도로 충분합니다.

1. **배포:** 아래 버튼을 누르고 GitHub로 로그인하면 내 계정에 저장소가 복사되고 배포됩니다. 배포 중에 **LILAC_PASSWORD**를 묻습니다. 앱에서 쓸 비밀번호(8자 이상)를 정해 넣으세요.

   [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fwhispelyn-byte%2FLilacAnime-server&project-name=lilacanime-server&repository-name=lilacanime-server&env=LILAC_PASSWORD&envDescription=%EC%95%B1%EC%97%90%EC%84%9C%20%EC%84%9C%EB%B2%84%EC%97%90%20%EC%97%B0%EA%B2%B0%ED%95%A0%20%EB%95%8C%20%EC%93%B8%20%EB%B9%84%EB%B0%80%EB%B2%88%ED%98%B8%20(8%EC%9E%90%20%EC%9D%B4%EC%83%81))

   버튼 대신 이 저장소를 포크한 뒤 [vercel.com/new](https://vercel.com/new)에서 가져와도 됩니다 (Framework Preset: **Other**, 나머지는 그대로).
2. **저장소 연결:** Vercel에서 만든 프로젝트 > **Storage** 탭 > **Create Database** > **Upstash for Redis**(무료 플랜)를 만들고 이 프로젝트에 연결합니다. 환경 변수(`UPSTASH_REDIS_REST_URL` / `KV_REST_API_URL` 등)는 자동으로 들어갑니다.
3. **다시 배포:** **Deployments** 탭에서 가장 최근 배포의 ⋯ > **Redeploy**를 누릅니다. 환경 변수는 다시 배포해야 적용됩니다.
4. **주소 확인:** 프로젝트 첫 화면의 **Domains**에 있는 고정 주소(예: `https://lilacanime-server.vercel.app`)를 씁니다. 배포마다 생기는 `…-a1b2c3d4-계정.vercel.app` 같은 주소는 Vercel 보호 기능(Vercel Authentication) 때문에 Vercel에 로그인한 브라우저에서만 열려서 앱이 연결하지 못합니다. 그런 주소밖에 없다면 **Settings > Deployment Protection**에서 **Vercel Authentication**을 끄세요.
5. **확인:** 그 주소를 Vercel에 로그인하지 않은 창(시크릿 창)으로 열면 "서버가 준비되었습니다"가 나옵니다. 설정이 덜 됐으면 무엇이 빠졌는지 알려 줍니다.

## 앱에 연결하기

- **데스크톱:** 설정(톱니바퀴) > **기기 동기화**에 서버 주소와 비밀번호를 넣고 **연결**.
- **휴대폰:** 앱의 기기 동기화 설정에 같은 주소와 비밀번호를 넣습니다.

비밀번호는 연결할 때 한 번만 보내고, 앱은 서버가 준 토큰만 저장합니다. Vercel에서 **LILAC_PASSWORD**를 바꾸고 다시 배포하면 연결된 기기가 모두 끊기니, 기기를 잃어버렸을 때는 비밀번호를 바꾸세요. 한 주소에서 비밀번호를 10번 틀리면 10분 동안 막힙니다.

## 동기화 규칙

- 항목 단위로 맞춥니다: 내 목록의 작품 하나, 시청 기록의 회차 하나.
- 같은 항목을 두 기기에서 바꾸면 **나중에 바꾼 쪽**(항목의 `updated` 시각)이 남습니다.
- 지운 항목은 지웠다는 표시(`deleted: true`)로 남아 다른 기기에서도 지워집니다.
- 서버는 쓸 때마다 **리비전** 번호를 하나씩 올립니다. 기기는 마지막으로 받은 리비전 다음부터만 받아 가므로 기기 시계가 달라도 빠짐없이 받습니다.

## API

모든 응답은 JSON입니다. 다른 출처에서도 부를 수 있게 CORS를 열어 두었습니다(쿠키 없이 토큰으로 인증).

### `GET /api/status`

로그인 없이 서버 종류와 설정 상태를 알려 줍니다. 주소를 확인할 때 씁니다.

```json
{ "app": "lilacanime-server", "version": 1, "ready": true, "problems": [] }
```

`ready: false`이면 `problems`에 해야 할 일이 한국어로 들어 있습니다.

### `POST /api/login`

```json
{ "password": "LILAC_PASSWORD" }
```

→ `200 { "token": "..." }`. 이후 요청에 `Authorization: Bearer <token>` 헤더로 보냅니다. 비밀번호가 틀리면 `401`, 너무 많이 틀리면 `429`.

### `POST /api/sync` (토큰 필요)

이 기기에서 바뀐 항목을 보냅니다. 한 번에 500개까지.

```json
{ "items": [
  { "collection": "library", "id": "reanime:frieren", "updated": 1791620000000, "data": { "mal_id": "reanime:frieren", "title": "장송의 프리렌", "savedAt": 1791620000000 } },
  { "collection": "history", "id": "reanime:frieren:1", "updated": 1791620500000, "data": { "key": "reanime:frieren:1", "progress": 42, "updated": 1791620500000 } },
  { "collection": "library", "id": "miruro:123", "updated": 1791621000000, "deleted": true }
] }
```

| 필드 | 설명 |
|---|---|
| `collection` | `library`(내 목록) 또는 `history`(시청 기록) |
| `id` | 항목 키 (512자 이하). 내 목록은 작품의 `mal_id`, 시청 기록은 기록의 `key` |
| `updated` | 이 기기에서 바꾼 시각 (ms). 서버의 것보다 커야 저장됩니다 |
| `data` | 항목 전체 (64KB 이하). 서버는 내용을 해석하지 않고 그대로 보관합니다 |
| `deleted` | `true`면 지운 항목 (`data` 없음) |

→ `200 { "rev": 42, "accepted": 2, "current": [ ... ] }`

`current`에는 보낸 것보다 서버에 있는 것이 더 새로워서 저장하지 않은 항목의 서버 쪽 내용이 들어 있습니다. 기기는 이것으로 자기 것을 바꿉니다.

### `GET /api/sync?since=<rev>` (토큰 필요)

리비전 `since` 다음에 바뀐 항목을 오래된 변경부터 500개씩 줍니다. 처음에는 `since=0`.

```json
{ "items": [ { "collection": "library", "id": "...", "updated": 1791620000000, "data": { }, "rev": 41 } ], "more": false, "rev": 42 }
```

`more: true`이면 `since=<rev>`로 이어서 받습니다. 받은 `rev`를 저장해 두고 다음 동기화 때 씁니다.

### 데이터 모양 (데스크톱 앱 기준)

서버는 `data`를 해석하지 않지만, 두 앱이 서로의 항목을 읽으려면 같은 모양을 써야 합니다. 데스크톱 앱이 쓰는 필드는 다음과 같습니다.

- **library** (`id` = `mal_id`): `provider`, `id`, `mal_id`, `title`, `title_english`, `title_japanese`, `images.webp.large_image_url`, `score`, `year`, `type`, `episodes`, `savedAt`(내 목록에 담은 시각, ms) 등 작품 정보.
- **history** (`id` = `key`): `key`(작품과 회차를 가리키는 키), `name`("작품 · 3화"), `episode`(회차 정보, `number` 포함), `anime`(작품 정보), `image`, `progress`(0~100), `updated`(마지막으로 본 시각, ms) 등.

### 동기화 순서 (권장)

1. 마지막 동기화 때의 각 항목 해시(스냅숏)와 지금 목록을 비교해 바뀐 항목·지운 항목을 `POST /api/sync`로 보냅니다.
2. 응답의 `current`로 자기 항목을 바꿉니다.
3. `GET /api/sync?since=<저장한 rev>`를 `more`가 `false`일 때까지 받아 반영하고, `rev`와 스냅숏을 저장합니다.

데스크톱 앱의 구현은 LilacAnime-desktop 저장소의 `src/device-sync.js`에 있습니다.

## 개발

```bash
npm test
```

```bash
LILAC_PASSWORD=비밀번호123 node dev.js
```

`dev.js`는 같은 API를 `http://localhost:3000`에 띄웁니다. Upstash 환경 변수가 없으면 데이터를 메모리에 둡니다(종료하면 사라짐). 데스크톱 앱의 기기 동기화에 `http://127.0.0.1:3000`을 넣어 시험할 수 있습니다.

외부 패키지 없이 Node.js 20 이상의 `fetch`로 Upstash REST API를 부릅니다.

## 라이선스

MIT
