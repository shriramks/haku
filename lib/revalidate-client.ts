// Call from client components after Supabase mutations to bust unstable_cache.
export async function revalidateTags(...tags: string[]): Promise<void> {
  await fetch('/api/revalidate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags }),
  })
}
