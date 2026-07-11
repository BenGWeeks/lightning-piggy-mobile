Pod::Spec.new do |s|
  s.name           = 'NostrNative'
  s.version        = '0.1.0'
  s.summary        = 'rust-nostr crypto primitives for Lightning Piggy'
  s.description    = 'Native NIP-44 encrypt/decrypt and BIP-340 schnorr sign/verify. iOS stub only — the real implementation (rust-nostr Swift bindings) lands in a later Stage 2 milestone; until then JS falls back to nostr-tools/@noble.'
  s.author         = 'Lightning Piggy'
  s.homepage       = 'https://github.com/BenGWeeks/lightning-piggy-mobile'
  s.license        = { type: 'MIT' }
  s.platforms      = { ios: '15.1' }
  s.source         = { git: 'https://github.com/BenGWeeks/lightning-piggy-mobile.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
end
