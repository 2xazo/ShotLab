FROM node:20-alpine

WORKDIR /app

# Install deps first (better layer caching)
COPY package.json ./
RUN npm install --omit=optional

# Prisma needs the schema at generate time
COPY prisma ./prisma
RUN npx prisma generate

COPY . .

EXPOSE 4000
CMD ["node", "src/index.js"]
