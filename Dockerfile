

FROM ghcr.io/puppeteer/puppeteer:latest

# Environment variables to skip download and point to installed chrome
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /usr/src/app

COPY package*.json ./

# Use npm install for better compatibility, user pptruser is default in this image
# We need to be root to install packages globally or in the dir if permissions are weird, 
# but usually in this image updates in WORKDIR are fine if own by pptruser.
# However, to be safe, we can switch to root, install, then back.
USER root
RUN npm install
USER pptruser

COPY . .

EXPOSE 3000
CMD [ "node", "index.js" ]
