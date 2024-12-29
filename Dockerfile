# Use the official Node.js 20 image as the base image
FROM node:22

# Set the working directory
WORKDIR /usr/src/app

# Copy the package.json and package-lock.json files for both gpx and website
COPY gpx/ ./gpx/
COPY website/ ./website/
COPY website/.env ./website/.env


# Install dependencies for gpx
RUN npm install --prefix gpx

# Build gpx
RUN npm run build --prefix gpx

# Install dependencies for website
RUN npm install --prefix website

# Copy the rest of the application code
COPY . .

# Build the website
RUN npm run build --prefix website


# Install a simple HTTP server to serve the built files
RUN npm install -g serve

# Expose the port the app runs on
EXPOSE 5173

# Set environment variables
ENV HOST=0.0.0.0

# Start the application
CMD ["serve", "-s", "website/build", "-l", "5173"]