# Changelog

## [1.0.1](https://github.com/yohi/herdr-opencode-child-panes/compare/v1.0.0...v1.0.1) (2026-09-17)


### Bug Fixes

* fix release-publish lint failure ([9651fa5](https://github.com/yohi/herdr-opencode-child-panes/commit/9651fa5e9e4ca0aa51e9d8c279e08fc918252bc9))
* fix release-publish lint failure ([82c67a6](https://github.com/yohi/herdr-opencode-child-panes/commit/82c67a6752edaa38a53cb882c32b2166388e451f))

## 1.0.0 (2026-09-17)


### Features

* **attach:** safely build opencode attach command and harden credential handling ([#7](https://github.com/yohi/herdr-opencode-child-panes/issues/7), [#11](https://github.com/yohi/herdr-opencode-child-panes/issues/11)) ([22a52b8](https://github.com/yohi/herdr-opencode-child-panes/commit/22a52b8f7e24bf3b20713db27f2641fccc833328))
* **attach:** safely build opencode attach command and harden credential handling ([#7](https://github.com/yohi/herdr-opencode-child-panes/issues/7), [#11](https://github.com/yohi/herdr-opencode-child-panes/issues/11)) ([2a240cc](https://github.com/yohi/herdr-opencode-child-panes/commit/2a240cc717060e0085e3d7be29eed39df128fdfc))
* **capacity:** enforce child pane capacity limit on serialized spawn path ([#10](https://github.com/yohi/herdr-opencode-child-panes/issues/10)) ([54f45c1](https://github.com/yohi/herdr-opencode-child-panes/commit/54f45c1e828512a035a11d16b12da860a17f87c9))
* **capacity:** enforce child pane capacity limit on serialized spawn path ([#10](https://github.com/yohi/herdr-opencode-child-panes/issues/10)) ([bf0285e](https://github.com/yohi/herdr-opencode-child-panes/commit/bf0285edd688ee46ad6b986f75a5df99e12ecb59))
* **child-session:** implement child session registry and lifecycle state machine ([#5](https://github.com/yohi/herdr-opencode-child-panes/issues/5)) ([3f7333c](https://github.com/yohi/herdr-opencode-child-panes/commit/3f7333c6705b1d9e242a3099373c360f2fe59270))
* **child-session:** implement child session registry and lifecycle state machine ([#5](https://github.com/yohi/herdr-opencode-child-panes/issues/5)) ([d1c2f81](https://github.com/yohi/herdr-opencode-child-panes/commit/d1c2f810edab0e93333710165c6f717fa6751010))
* **cleanup:** implement stable idle pane cleanup and retry limit ([#8](https://github.com/yohi/herdr-opencode-child-panes/issues/8)) ([3c87bb0](https://github.com/yohi/herdr-opencode-child-panes/commit/3c87bb051969167bf8ff466ad1a9b953f72fd05a))
* **cleanup:** implement stable idle pane cleanup and retry limit ([#8](https://github.com/yohi/herdr-opencode-child-panes/issues/8)) ([22fb6a3](https://github.com/yohi/herdr-opencode-child-panes/commit/22fb6a31f1a1e37c9f4a503a81dc620e0f67b73b))
* add GitHub Packages release automation ([a0dabd2](https://github.com/yohi/herdr-opencode-child-panes/commit/a0dabd28d336e8150bb6d17374b7164ec27b4846))
* add GitHub Packages release automation ([bf56c2b](https://github.com/yohi/herdr-opencode-child-panes/commit/bf56c2bcb8a4984d0c06e78249141524184f2edb))
* add Herdr CLI adapter ([0d27a0d](https://github.com/yohi/herdr-opencode-child-panes/commit/0d27a0d61d92acbab34b9cdafcc5280c2666deb9))
* add Herdr CLI adapter ([cecb70d](https://github.com/yohi/herdr-opencode-child-panes/commit/cecb70df32e894fe2a6940b0cb856db7bd284ba6)), closes [#2](https://github.com/yohi/herdr-opencode-child-panes/issues/2)
* add resolver for root OpenCode session from Herdr pane ([654d108](https://github.com/yohi/herdr-opencode-child-panes/commit/654d1089f59fc3df8dde3d065dbc5337f34389af))
* add resolver for current root OpenCode session from Herdr pane ([351f8db](https://github.com/yohi/herdr-opencode-child-panes/commit/351f8dbd244031cfa93977ece9a57e2d7361aa35))
* **layout:** implement focus-preserving split and direction decision policy ([#6](https://github.com/yohi/herdr-opencode-child-panes/issues/6)) ([c56bb2c](https://github.com/yohi/herdr-opencode-child-panes/commit/c56bb2c93900450081c0a8b88e74b2bd7d4b000d))
* **layout:** implement focus-preserving split and direction decision policy ([#6](https://github.com/yohi/herdr-opencode-child-panes/issues/6)) ([15a3bf3](https://github.com/yohi/herdr-opencode-child-panes/commit/15a3bf3bbd5f8f3035a1f95bb3942c8bc900cd86))
* add foundation for OpenCode child session companion plugin ([5fb917c](https://github.com/yohi/herdr-opencode-child-panes/commit/5fb917c4061c9b23a52f7a5077ed57d6f2961817))
* add foundation for OpenCode child session companion plugin ([b19628f](https://github.com/yohi/herdr-opencode-child-panes/commit/b19628f79d496a2d5a873de9b6b056e8571ad2dc))
* **ownership:** implement child session ownership and hierarchy tracking ([#4](https://github.com/yohi/herdr-opencode-child-panes/issues/4)) ([7be567a](https://github.com/yohi/herdr-opencode-child-panes/commit/7be567a2cb5266890212f6cfd1a13839edefa4d0))
* **ownership:** implement child session ownership and hierarchy tracking ([#4](https://github.com/yohi/herdr-opencode-child-panes/issues/4)) ([60e5916](https://github.com/yohi/herdr-opencode-child-panes/commit/60e5916138fd1e57a693994014b03bef21577b0c))
* add agent_session field to PaneInfo schema ([9370521](https://github.com/yohi/herdr-opencode-child-panes/commit/9370521ddf85ea4af3663180fce0bea202e9c396))
* **queue:** serialize pane splits and closes and isolate errors ([#9](https://github.com/yohi/herdr-opencode-child-panes/issues/9)) ([a5bc6ee](https://github.com/yohi/herdr-opencode-child-panes/commit/a5bc6ee907449b2d3d46fb91049ca1b960199a23))
* **queue:** serialize pane splits and closes and isolate errors ([#9](https://github.com/yohi/herdr-opencode-child-panes/issues/9)) ([080bff4](https://github.com/yohi/herdr-opencode-child-panes/commit/080bff4da13c986edbe736f64c61acd2fdda1d54))
* **visualize:** implement activity-driven child pane split and attach ([#6](https://github.com/yohi/herdr-opencode-child-panes/issues/6), [#7](https://github.com/yohi/herdr-opencode-child-panes/issues/7)) ([f06f349](https://github.com/yohi/herdr-opencode-child-panes/commit/f06f3494bae9262bf0680de637f2a9a42088cdb3))
* **visualize:** implement activity-driven child pane split and attach ([#6](https://github.com/yohi/herdr-opencode-child-panes/issues/6), [#7](https://github.com/yohi/herdr-opencode-child-panes/issues/7)) ([6d3d95f](https://github.com/yohi/herdr-opencode-child-panes/commit/6d3d95f29620afc2847abc7dd1500699cc041cea))
* improve pane lifecycle reliability ([#8](https://github.com/yohi/herdr-opencode-child-panes/issues/8), [#9](https://github.com/yohi/herdr-opencode-child-panes/issues/9), [#10](https://github.com/yohi/herdr-opencode-child-panes/issues/10)) ([9742916](https://github.com/yohi/herdr-opencode-child-panes/commit/9742916ff3917f09a91879a7e69d181156e4a08e))
* implement child session ownership and lifecycle core ([#4](https://github.com/yohi/herdr-opencode-child-panes/issues/4), [#5](https://github.com/yohi/herdr-opencode-child-panes/issues/5)) ([225606a](https://github.com/yohi/herdr-opencode-child-panes/commit/225606ad233196f6b9a0e95202a7225bc0e6c57f))
* implement child pane visualization ([#6](https://github.com/yohi/herdr-opencode-child-panes/issues/6), [#7](https://github.com/yohi/herdr-opencode-child-panes/issues/7), [#11](https://github.com/yohi/herdr-opencode-child-panes/issues/11)) ([637d784](https://github.com/yohi/herdr-opencode-child-panes/commit/637d784b80a2efa3b49c8a7f54228ed65f975137))
* implement fixed layout for child panes ([b571e25](https://github.com/yohi/herdr-opencode-child-panes/commit/b571e2558aa4710e5297e2976beacad33d447a37))


### Bug Fixes

* correctly display command name for two-element argv ([18ec129](https://github.com/yohi/herdr-opencode-child-panes/commit/18ec129384a0090a08d2ec3c8a1d346ebd75ac74))
* **child-session:** fix event state transitions and ownership determination ([85c4caa](https://github.com/yohi/herdr-opencode-child-panes/commit/85c4caad3f2d544b6dd1e66a22c783fac0f2af70))
* **ci:** disable dependency install script for Sonar ([797c0a4](https://github.com/yohi/herdr-opencode-child-panes/commit/797c0a48b8e5a189ba691f907b04010a7a871705))
* **events:** resolve direct form of message.part.delta ([4c87f07](https://github.com/yohi/herdr-opencode-child-panes/commit/4c87f074d64e120b4df26d0708a7c5e7d0c4530e))
* improve Herdr CLI response handling and type definitions ([892804f](https://github.com/yohi/herdr-opencode-child-panes/commit/892804f4b5b9dc52f4f16cb84ec65f30ac63d42c))
* auto-close child panes on idle status ([4a26cf3](https://github.com/yohi/herdr-opencode-child-panes/commit/4a26cf3ce10d3881db7df49f26ee2ae958b081a5))
* change OpenCode log destination to server logs ([3a94577](https://github.com/yohi/herdr-opencode-child-panes/commit/3a94577d37bd4fc5026de7e61c517a5da8b81eb9))
* change OpenCode log destination to server logs ([10b32af](https://github.com/yohi/herdr-opencode-child-panes/commit/10b32afd9d0b3c2f0657517885c0ac3fb0f77ac0))
* address Sonar safety and readability findings ([d009830](https://github.com/yohi/herdr-opencode-child-panes/commit/d009830b55824759dd556969edd48616ce556d44))
* restrict activation log URL output to origin ([d1d1317](https://github.com/yohi/herdr-opencode-child-panes/commit/d1d13173840c049e737a22024f923f3635b92b40))
* clear old handle when replacing timer ([311b6e5](https://github.com/yohi/herdr-opencode-child-panes/commit/311b6e555b1c9dba5539f31debabb1e3238c4069))
* fix release workflow publish integration and tag handling ([2e5ab15](https://github.com/yohi/herdr-opencode-child-panes/commit/2e5ab15ca284da477597d284f12d0dbfeb80db31))
* prevent script execution during release dependency install ([0d5c6e0](https://github.com/yohi/herdr-opencode-child-panes/commit/0d5c6e0f0d51e2cd537d13219a3baffe8f67df9e))
* make release publishing retryable ([36061c4](https://github.com/yohi/herdr-opencode-child-panes/commit/36061c47333904e4819cd2c397e52939d347c86b))
* fix release publish procedure and authentication configuration ([b88f939](https://github.com/yohi/herdr-opencode-child-panes/commit/b88f939b32b94c144372264f415d94c5a09424e9))
* strengthen logger exception handling and defensiveness ([07b2791](https://github.com/yohi/herdr-opencode-child-panes/commit/07b27919cb0b06095b55bf03cdd18dd59888e073))
* correctly display command name in logs ([edd5811](https://github.com/yohi/herdr-opencode-child-panes/commit/edd5811a342453022f8e3f1bfe988cd454dba88a))
* reinforce log failure and debug URL safety ([0bec464](https://github.com/yohi/herdr-opencode-child-panes/commit/0bec464785a18aa0b30c8587d7695a866fee5eff))
* make publish process idempotent ([7f2160d](https://github.com/yohi/herdr-opencode-child-panes/commit/7f2160d623bb410e898e4a134020d059c0517de5))
* prevent pending spawn replay for already-deleted sessions ([b43b56d](https://github.com/yohi/herdr-opencode-child-panes/commit/b43b56d7598a38447078de9c4325861efb58b162))
* correctly display command name for single-element argv ([3b6c153](https://github.com/yohi/herdr-opencode-child-panes/commit/3b6c153253d4bd721d134a450a88701eb36b362c))
* prevent child session event drops ([6cba5e9](https://github.com/yohi/herdr-opencode-child-panes/commit/6cba5e912adc61160b2bde20a4866b0acb0a8258))
* prevent child session event drops ([11e906b](https://github.com/yohi/herdr-opencode-child-panes/commit/11e906baf20c119b9b79d6c13a32269bcf7e08fc))
* integrate child session event processing ([d9f83be](https://github.com/yohi/herdr-opencode-child-panes/commit/d9f83bea0fe5f0ed21e88c51736757c282d1ba9e))
* fix child session Herdr pane attach ([4b5b820](https://github.com/yohi/herdr-opencode-child-panes/commit/4b5b820102d96dc235cd0c49d48cfa7f01c7db0e))
* fix child pane attach resend and state logging ([b5f34e5](https://github.com/yohi/herdr-opencode-child-panes/commit/b5f34e5b5fe4576f79f4f3849de725ae80e88e6f))
* preserve child pane spawn order ([63db44b](https://github.com/yohi/herdr-opencode-child-panes/commit/63db44bf81fdc971f2cddb831b609997529e03b9))
* fix child pane spawn and credential handling ([6d5d546](https://github.com/yohi/herdr-opencode-child-panes/commit/6d5d546611acf064aec631b43119e2c9fbab8968))
* safely handle empty config and invalid event input ([a3c61df](https://github.com/yohi/herdr-opencode-child-panes/commit/a3c61df9c5add59cf6014a0cb1e858b478e6c346))
* prevent child pane restart on delayed events ([543dd70](https://github.com/yohi/herdr-opencode-child-panes/commit/543dd70a9ddefcc3e66df0f450e1f5dace02860f))


### Reverts

* revert merge of issue [#18](https://github.com/yohi/herdr-opencode-child-panes/issues/18) ([63fbf3e](https://github.com/yohi/herdr-opencode-child-panes/commit/63fbf3ed40b47332b97acd00ca1ba059de3fe68c))
