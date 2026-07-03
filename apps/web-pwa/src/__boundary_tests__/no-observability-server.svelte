<!--
  VIOLATION: a web-pwa .svelte <script> must obey the same import boundaries as
  its .ts files. @salt/observability/server (posthog-node + Node OTel) is for
  cloud-functions only — web-pwa uses the default @salt/observability subpath.
  This fixture exists because before issue #413, .svelte files bypassed ALL
  import enforcement: a <script> block could import anything.
  Expected: no-restricted-imports error.
-->
<script lang="ts">
  import { startSpan } from '@salt/observability/server';

  // Reference the symbol so the import is retained; the lint rule — not type
  // resolution — is what enforces the boundary.
  console.log(startSpan);
</script>
