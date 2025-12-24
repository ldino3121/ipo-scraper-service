
FROM ghcr.io/puppeteer/puppeteer:latest

WORKDIR /usr/src/app

COPY package*.json ./

# Switch to root to install dependencies (required for some puppeteer execution permissions)
USER root
RUN npm install
# Switch back to pptruser (default for this image) for security
USER pptruser

COPY . .

EXPOSE 3000
CMD [ "node", "index.js" ]
