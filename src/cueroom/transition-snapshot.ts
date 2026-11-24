export function transitionMetadata(id: string, track: Record<string,unknown>) {
  return {id,title:track.title,artist:track.artist,bpm:track.bpm ?? null,
    musicalKey:track.musicalKey ?? null,energy:track.energy ?? null}
}
export async function snapshotDigest(metadata: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(metadata))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))
  return Array.from(digest, b => b.toString(16).padStart(2,'0')).join('')
}
