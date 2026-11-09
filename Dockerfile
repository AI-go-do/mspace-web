# 1단계: 화면을 빌드한다
# 빌드 결과(jar·정적 파일)는 CPU와 상관없어서, 빌드는 러너 CPU에서 한 번만 한다 (arm64 이미지도 빠르게)
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# 관리자 센서 화면이 core API를 부를지(api) 가짜 값을 쓸지(mock). deploy.yml이 develop만 api로 넘긴다
ARG VITE_ADMIN_ENV_SOURCE=mock
ENV VITE_ADMIN_ENV_SOURCE=$VITE_ADMIN_ENV_SOURCE
# 관리자 기간 막기가 core API(#98)를 쓸지(api) 이 브라우저 가짜 저장소를 쓸지(mock). 위와 같이 develop만 api
ARG VITE_ADMIN_BLOCKS_SOURCE=mock
ENV VITE_ADMIN_BLOCKS_SOURCE=$VITE_ADMIN_BLOCKS_SOURCE
# 학생 빈방 릴레이가 core API(#101)를 쓸지(api), 예시 화면(?demo=1)에서만 보일지(mock). develop만 api
ARG VITE_RELAY_SOURCE=mock
ENV VITE_RELAY_SOURCE=$VITE_RELAY_SOURCE
RUN npm run build

# 2단계: 빌드 결과(정적 파일)만 nginx로 내보낸다
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
