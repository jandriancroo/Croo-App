// Theo memory fingerprints. Uses a real embedding model (not a chat model) so similar notes
// get similar vectors. 768 dims to match theo_knowledge.embedding.
export const EMBED_MODEL = "google/gemini-embedding-001";

export async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: text.slice(0, 8000), dimensions: 768 }),
    });
    if (!resp.ok) { console.error("Embedding API error:", resp.status, await resp.text()); return null; }
    const v = (await resp.json())?.data?.[0]?.embedding;
    return Array.isArray(v) && v.length === 768 ? v : null;
  } catch (e) { console.error("Embedding failed:", e); return null; }
}
