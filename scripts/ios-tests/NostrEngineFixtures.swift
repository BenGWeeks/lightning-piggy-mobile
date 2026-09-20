// Minimal SDK doubles for compiling the production engine lifecycle on macOS.
// No network, secret keys, or Rust artifacts are used by this regression test.
import Foundation
actor LifecycleProbe {
  var connectStarted = false
  var suspendConnect = true
  var continuation: CheckedContinuation<Void, Never>?
  var builds = 0
  var shutdowns = 0
  func connect() async {
    connectStarted = true
    if suspendConnect { await withCheckedContinuation { continuation = $0 } }
  }
  func release() { suspendConnect = false; continuation?.resume(); continuation = nil }
  func shutdown() { shutdowns += 1 }
}
let lifecycleProbe = LifecycleProbe()
struct Keys: Sendable { func publicKey() -> PublicKey { PublicKey() } }
struct PublicKey: Sendable { func toHex() -> String { "viewer" } }
struct NostrSigner: Sendable { static func keys(keys: Keys) -> NostrSigner { NostrSigner() } }
struct ClientBuilder { func signer(signer: NostrSigner) -> Self { self }; func build() -> Client { Client() } }
struct RelayUrl: Hashable, Sendable {
  var description: String = "relay"
  static func parse(url: String) throws -> RelayUrl { RelayUrl(description: url) }
}
enum RelayStatus { case connected }
struct Relay { func status() -> RelayStatus { .connected } }
struct Filter { static func fromJson(json: String) throws -> Filter { Filter() } }
struct SubscriptionOutput { let id = "subscription" }
struct RelayMessage {}
protocol HandleNotification: AnyObject {
  func handle(relayUrl: RelayUrl, subscriptionId: String, event: Event) async
  func handleMsg(relayUrl: RelayUrl, msg: RelayMessage) async
}
final class Client: @unchecked Sendable {
  func addRelay(url: RelayUrl) async throws -> Bool { true }
  func connect() async { await lifecycleProbe.connect() }
  func disconnect() async {}
  func shutdown() async { await lifecycleProbe.shutdown() }
  func handleNotifications(handler: HandleNotification) async throws {}
  func subscribe(filter: Filter, opts: String?) async throws -> SubscriptionOutput { SubscriptionOutput() }
  func unwrapGiftWrap(giftWrap: Event) async throws -> Unwrapped { Unwrapped() }
  func relays() async -> [RelayUrl: Relay] { [:] }
}
struct Kind { func asU16() -> UInt16 { 1059 } }
struct EventId { func toHex() -> String { "event" } }
struct Timestamp { func asSecs() -> UInt64 { 0 } }
struct Event {
  func kind() -> Kind { Kind() }
  func id() -> EventId { EventId() }
  func createdAt() -> Timestamp { Timestamp() }
}
struct Rumor {
  func author() -> PublicKey { PublicKey() }
  func asJson() throws -> String { "{}" }
}
struct Unwrapped { func sender() -> PublicKey { PublicKey() }; func rumor() -> Rumor { Rumor() } }
