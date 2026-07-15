# MySQL Setup

Prisma `P1000` 오류는 대부분 `.env`의 계정 정보와 실제 MySQL 계정 정보가 다를 때 발생합니다.

현재 macOS에서 Homebrew MySQL이 `localhost:3306`을 이미 사용 중이면 Docker MySQL이 아니라 로컬 MySQL에 접속합니다.

## Option A: Homebrew MySQL 사용

`localhost:3306`에 이미 MySQL이 실행 중이면 이 방법이 가장 빠릅니다.

먼저 root 계정으로 MySQL에 접속합니다.

```bash
mysql -uroot -p
```

MySQL 콘솔에서 아래 SQL을 실행합니다.

```sql
CREATE DATABASE IF NOT EXISTS readnest
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'readnest_user'@'localhost'
  IDENTIFIED BY 'ReadNest2026!';

GRANT ALL PRIVILEGES ON readnest.* TO 'readnest_user'@'localhost';

GRANT CREATE, DROP, ALTER, REFERENCES ON *.* TO 'readnest_user'@'localhost';

FLUSH PRIVILEGES;
```

프로젝트 `.env`는 아래처럼 둡니다.

```env
DATABASE_URL="mysql://readnest_user:ReadNest2026!@localhost:3306/readnest"
PORT=3000
```

접속 확인:

```bash
mysql -ureadnest_user -p'ReadNest2026!' -h 127.0.0.1 readnest -e "SELECT DATABASE();"
```

마이그레이션:

```bash
npm run prisma:migrate -- --name init
```

## Prisma shadow database 권한 오류

마이그레이션 중 아래 오류가 나면 `readnest_user`가 Prisma의 임시 shadow database를 만들 권한이 없는 상태입니다.

```text
Error: P3014
Prisma Migrate could not create the shadow database.
```

root 계정으로 MySQL에 접속합니다.

```bash
mysql -uroot -p
```

아래 권한을 추가합니다.

```sql
GRANT CREATE, DROP, ALTER, REFERENCES ON *.* TO 'readnest_user'@'localhost';

FLUSH PRIVILEGES;
```

그 다음 다시 실행합니다.

```bash
npm run prisma:migrate -- --name init
```

## Option B: Docker MySQL 사용

Docker Desktop을 먼저 실행해야 합니다.

Homebrew MySQL이 이미 `3306`을 사용 중일 수 있으므로 Docker MySQL은 호스트 `3307` 포트로 노출합니다.

```bash
cp .env.docker.example .env
docker compose -f docker-compose.local.yml up -d
npm run prisma:migrate -- --name init
```

Docker DB 접속 정보:

```env
DATABASE_URL="mysql://readnest_user:ReadNest2026!@localhost:3307/readnest"
```

## 기존 Docker 볼륨 비밀번호가 꼬인 경우

Docker MySQL은 최초 생성 시점의 비밀번호를 볼륨에 저장합니다. 이후 `docker-compose.local.yml`의 비밀번호를 바꿔도 기존 볼륨에는 반영되지 않습니다.

개발 DB를 초기화해도 괜찮다면 아래 명령으로 볼륨을 지운 뒤 다시 시작합니다.

```bash
docker compose -f docker-compose.local.yml down -v
docker compose -f docker-compose.local.yml up -d
```
