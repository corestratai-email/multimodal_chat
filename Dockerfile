# Use Node 22
FROM node:22

# Set working directory
WORKDIR /app

# Copy package files first (for caching)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy rest of the code
COPY . .

# Build the React app
RUN npm run build

# Use production-ready server (serve)
RUN npm install -g serve

# Start the server
CMD ["serve", "-s", "build", "-l", "3000"]

# Expose frontend port
EXPOSE 3000
