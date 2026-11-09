FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV HOST=0.0.0.0
ENV PORT=5173
EXPOSE 5173
CMD ["npm", "run", "dev"]
