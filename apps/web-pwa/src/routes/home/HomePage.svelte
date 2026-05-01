<script lang="ts">
  import { Card, CardContent, CardHeader, CardTitle, Text } from '@salt/ui-components';
</script>

<div class="p-4 sm:p-6 space-y-6">
  <div>
    <h1 class="text-2xl font-semibold tracking-tight text-foreground">Home</h1>
    <Text muted class="mt-1">Welcome to Salt.</Text>
  </div>

  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
    <Card>
      <CardHeader><CardTitle>Items</CardTitle></CardHeader>
      <CardContent>
        <Text muted>Your canonical item database.</Text>
      </CardContent>
    </Card>
  </div>
</div>
