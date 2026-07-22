FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work

RUN apt-get update && apt-get install -y \
    git \
    make \
    ca-certificates \
    curl \
    vim \
    gcc \
    pkg-config \
    libx11-dev \
    libxrandr-dev \
    libxinerama-dev \
    libxcursor-dev \
    libxi-dev \
    libgl1-mesa-dev \
    libxkbcommon-dev \
    && rm -rf /var/lib/apt/lists/*



# keep container running so you can exec into it
CMD ["sleep", "infinity"]
