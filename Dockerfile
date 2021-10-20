FROM nginx
COPY nginx.conf /etc/nginx/nginx.conf

RUN mkdir /data /app
RUN chown nginx:nginx /data /app
