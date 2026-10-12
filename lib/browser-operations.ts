/** Browser-only transport. Authorization stays in the route and RPC. */
export async function browserOperation<T>(
  path: string,
  input: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("No fue posible confirmar la operación.");
  return response.json() as Promise<T>;
}
