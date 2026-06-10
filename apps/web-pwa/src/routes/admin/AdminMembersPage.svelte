<script lang="ts">
  import {
    Button,
    Checkbox,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Icon,
    ListPage,
    SortableList,
    TextField,
  } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import { memberInitials, type Member } from '@salt/domain';
  import AdminGuard from './AdminGuard.svelte';
  import {
    members,
    isLoadingMembers,
    createMemberEntry,
    updateMemberEntry,
    deleteMemberEntry,
    reorderMembers,
  } from '../../lib/membersService.js';
  import { addToast } from '../../lib/toastStore.js';

  // ─── Create / edit dialog state ───────────────────────────────────────────
  let showEditor = $state(false);
  let editingId = $state<string | null>(null); // null → creating
  let formName = $state('');
  let formEmail = $state('');
  let formAdmin = $state(false);
  let saving = $state(false);

  const isEditing = $derived(editingId !== null);

  function openCreate(): void {
    editingId = null;
    formName = '';
    formEmail = '';
    formAdmin = false;
    showEditor = true;
  }

  function openEdit(member: Member): void {
    editingId = member.id;
    formName = member.name;
    formEmail = member.email;
    formAdmin = member.admin;
    showEditor = true;
  }

  async function handleSave(): Promise<void> {
    const name = formName.trim();
    const email = formEmail.trim();
    if (!name || (!isEditing && !email)) {
      addToast('Name and email are required.', 'error');
      return;
    }
    saving = true;
    const result = isEditing
      ? await updateMemberEntry(editingId!, { name, admin: formAdmin })
      : await createMemberEntry({ name, email, admin: formAdmin });
    saving = false;

    if (result.kind !== 'ok') {
      addToast(isEditing ? 'Failed to save member.' : 'Failed to add member.', 'error');
      return;
    }
    showEditor = false;
  }

  // ─── Delete dialog state ──────────────────────────────────────────────────
  let deleteTarget = $state<Member | null>(null);
  let deleting = $state(false);

  async function handleDelete(): Promise<void> {
    if (!deleteTarget) return;
    deleting = true;
    const result = await deleteMemberEntry(deleteTarget.id);
    deleting = false;
    deleteTarget = null;
    if (result.kind !== 'ok') {
      addToast('Failed to remove member.', 'error');
    }
  }
</script>

<AdminGuard>
  <ListPage
    title="Members"
    description="Who can sign in to Salt, and who is an admin."
    isLoading={$isLoadingMembers}
    isEmpty={$members.length === 0}
    class="p-4 sm:p-6"
  >
    {#snippet actions()}
      <Button size="sm" onclick={() => push('/admin')}>Back to admin</Button>
      <Button size="sm" onclick={openCreate} data-testid="member-add">Add member</Button>
    {/snippet}

    {#snippet children()}
      <div data-testid="members-list">
        <SortableList
          items={$members}
          getId={(m) => m.id}
          onReorder={reorderMembers}
          class="divide-y divide-border rounded border"
        >
          {#snippet row(member)}
            <div
              class="flex items-center gap-3 px-3 py-3"
              data-testid="member-row"
              data-member-id={member.id}
            >
              <span
                data-testid={`member-drag-handle-${member.id}`}
                class="cursor-grab text-muted-foreground"
              >
                <Icon name="GripVertical" size={16} />
              </span>
              <span
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                aria-hidden="true"
              >
                {memberInitials(member.name)}
              </span>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="truncate text-sm font-medium">{member.name}</span>
                  {#if member.admin}
                    <span
                      class="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary"
                      data-testid="member-admin-badge"
                    >
                      Admin
                    </span>
                  {/if}
                </div>
                <span class="truncate text-xs text-muted-foreground">{member.email}</span>
              </div>
              <div class="flex items-center gap-1">
                <Button variant="ghost" size="sm" onclick={() => openEdit(member)}>Edit</Button>
                <Button variant="ghost" size="sm" onclick={() => (deleteTarget = member)}
                  >Remove</Button
                >
              </div>
            </div>
          {/snippet}
        </SortableList>
      </div>
    {/snippet}
  </ListPage>
</AdminGuard>

<!-- Create / edit member -->
<Dialog
  open={showEditor}
  onOpenChange={(v) => {
    if (!v) showEditor = false;
  }}
>
  <DialogContent>
    <div class="flex flex-col gap-4" data-testid="member-editor">
      <DialogHeader>
        <DialogTitle>{isEditing ? 'Edit member' : 'Add member'}</DialogTitle>
        <DialogDescription>
          {isEditing
            ? 'Update this member. Email is the account key and cannot be changed here.'
            : 'Only people on this list can sign in.'}
        </DialogDescription>
      </DialogHeader>
      <TextField label="Name" bind:value={formName} data-testid="member-name-input" />
      <TextField
        label="Email"
        type="email"
        bind:value={formEmail}
        disabled={isEditing}
        data-testid="member-email-input"
      />
      <Checkbox bind:checked={formAdmin} label="Admin" data-testid="member-admin-input" />
      <DialogFooter>
        <Button variant="outline" onclick={() => (showEditor = false)} disabled={saving}>
          Cancel
        </Button>
        <Button onclick={handleSave} loading={saving} disabled={saving} data-testid="member-save">
          {isEditing ? 'Save' : 'Add'}
        </Button>
      </DialogFooter>
    </div>
  </DialogContent>
</Dialog>

<!-- Remove member -->
<Dialog
  open={deleteTarget !== null}
  onOpenChange={(v) => {
    if (!v) deleteTarget = null;
  }}
>
  <DialogContent>
    <div class="flex flex-col gap-4" data-testid="member-delete-dialog">
      <DialogHeader>
        <DialogTitle>Remove {deleteTarget?.name}?</DialogTitle>
        <DialogDescription>
          They will no longer be able to sign in. This cannot be undone.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onclick={() => (deleteTarget = null)} disabled={deleting}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          onclick={handleDelete}
          loading={deleting}
          disabled={deleting}
          data-testid="member-delete-confirm"
        >
          Remove
        </Button>
      </DialogFooter>
    </div>
  </DialogContent>
</Dialog>
