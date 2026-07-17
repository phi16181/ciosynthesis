/** Standard cosine similarity between two equal-length embedding vectors. */
export function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Returns the top-K chunks most similar to a query embedding, highest first.
 * `chunks` and `embeddings` must be parallel arrays (same order, same length).
 */
export function retrieveTopChunks(queryEmbedding, embeddings, chunks, k = 15) {
  const scored = chunks.map((chunk, i) => ({
    chunk,
    score: cosineSimilarity(queryEmbedding, embeddings[i]),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((s) => s.chunk);
}
