# Firebase test-emulator runtime image (issue #84, Phase 1).
#
# Scope: a self-contained runtime for the Firebase test emulator stack
# (Firestore + Auth + Functions). It bakes in firebase-tools, a headless JRE
# (Firestore emulator is a JVM), and pre-downloads the emulator jars so a
# fresh `up` never races a network download. It contains NO repo code: the
# repo (config + the prebuilt Cloud Functions bundle + pnpm-linked runtime
# deps) is bind-mounted read-only at /repo by docker-compose.test.yml.
FROM node:22-bookworm-slim

# firebase-tools v15+ requires a JDK >= 21 (the Firestore emulator runtime).
# Debian bookworm's default JRE is 17, so pull Temurin 21 from the Adoptium
# apt repo — a fixed JDK 21 independent of the Debian release. curl is also
# used by the container healthcheck (timer-bounded probes only).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && mkdir -p /etc/apt/keyrings \
  && curl -fsSL https://packages.adoptium.net/artifactory/api/gpg/key/public \
       | gpg --dearmor -o /etc/apt/keyrings/adoptium.gpg \
  && echo "deb [signed-by=/etc/apt/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb $(. /etc/os-release && echo "$VERSION_CODENAME") main" \
       > /etc/apt/sources.list.d/adoptium.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends temurin-21-jre \
  && rm -rf /var/lib/apt/lists/*

# Pin the firebase-tools major to match the repo's devDependency (^15.17.0)
# so the emulator behaviour in the container matches the host toolchain.
RUN npm install -g firebase-tools@^15.17.0

# Bake the Firestore + UI emulator jars into the image. Without this, the
# first `up` on a clean machine/CI runner blocks on a jar download — exactly
# the kind of cold-start non-determinism issue #84 is removing.
RUN firebase setup:emulators:firestore \
  && firebase setup:emulators:ui

COPY healthcheck.sh /usr/local/bin/healthcheck.sh
RUN chmod +x /usr/local/bin/healthcheck.sh

# Writable scratch dir for firebase-debug.log / firestore-debug.log etc.
# The repo mount is read-only, so the emulator must not run with its cwd
# inside /repo. docker-compose mounts a named volume here.
WORKDIR /work

# --config points at the container mirror of firebase.test.json (adds
# host:0.0.0.0 so the mapped ports are reachable from the host; ports and
# project paths are identical to firebase.test.json). Project root resolves
# to /repo, so functions source / firestore.rules paths resolve exactly as
# they do for firebase.test.json.
CMD ["firebase", "emulators:start", \
     "--config", "/repo/firebase.test.docker.json", \
     "--project", "demo-salt", \
     "--only", "auth,firestore,functions"]
