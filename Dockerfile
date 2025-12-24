
FROM ghcr.io/puppeteer/puppeteer:latest

# Switch to root to install if needed (though puppeteer image handles most)
# USER root

# WORKDIR
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install deps (ci for clean install)
RUN npm ci

# Copy source
COPY . .

# Expose Port
EXPOSE 3000

# Start command
CMD [ "node", "index.js" ]
