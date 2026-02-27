# Use Node.js 20 base image
FROM node:20-slim

# Install build dependencies for better-sqlite3 (python3, make, g++)
# These are often needed if prebuilds aren't available for the architecture
# Added flags to bypass "Release file is not valid yet" errors caused by clock skew
RUN apt-get -o Acquire::Check-Valid-Until=false -o Acquire::Check-Date=false update && \
    apt-get install -y python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including devDependencies for tsx)
RUN npm install

# Copy source code
COPY . .

# Build the frontend (Vite)
RUN npm run build

# Expose the application port
EXPOSE 3000

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Start the application using tsx (to run TypeScript server directly)
CMD ["npx", "tsx", "server.ts"]
