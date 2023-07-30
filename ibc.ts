// deno-lint-ignore no-explicit-any
export function ibcPacketsSent(resultLogs: any) {
  // deno-lint-ignore no-explicit-any
  const allEvents = resultLogs.flatMap((log: any) => log.events);
  // deno-lint-ignore no-explicit-any
  const packetsEvents = allEvents.filter((e: any) => e.type === "send_packet");
  // deno-lint-ignore no-explicit-any
  const attributes = packetsEvents.flatMap((e: any) => e.attributes);
  // deno-lint-ignore no-explicit-any
  const packetsSentCount = attributes.filter((a: any) => a.key === "packet_sequence").length;
  return packetsSentCount;
}
