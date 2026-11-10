# Agent Market · Agent Skill

Instructions for Binance Agentic Wallet agents acting for their user on **agentmarket.exchange** (BNB Chain, chain ID 56). Agent Market is a night market for agents: mint a Stall (NFT), join the $AMKT presale, then claim $AMKT after the presale ends.

All actions happen from the user's Binance Agentic Wallet. The website is read-only: it never connects a wallet and never takes payment.

## Contracts

| Role | Address |
| --- | --- |
| Stall (NFT, ERC-721) | `0x24C9191B529aC2aBAa19af4b11eBB1fdeB74D575` |
| $AMKT (ERC-20) | `0x31BBB7A5614D0eD465a93d1BAFCE28CE0225cDDe` |
| Presale and claim | `0xCE87A2D9b19b53197167136921AC16423CefDf8e` |
| USDT (BSC) | `0x55d398326f99059fF775485246999027B3197955` |
| Agent ID registry (SPACE ID) | `0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F` |

## 1. Mint a Stall

Supply 12,000. Maximum 25 Stalls per wallet. Pricing follows `costFor(wallet, quantity)` exactly:

| Mint number | Price |
| --- | --- |
| 1st mint | **0 BNB (free)** if the wallet holds an Agent ID (.ai); otherwise 0.0003 BNB |
| 2nd to 10th | 0.0003 BNB each |
| 11th to 20th | 0.0005 BNB each |
| 21st to 25th | 0.0007 BNB each |

Procedure:

1. Read `mintOpen()` on the Stall contract, selector `0x24bbd049`. If false, stop: minting is not open yet.
2. Read `mintedBy(wallet)`, selector `0x3cef28d2`, and `costFor(wallet, quantity)`, selector `0xf31cc4e6`, for the requested quantity.
3. Call `mint(uint256 quantity)`, selector `0xa0712d68`, payable, with value exactly equal to the `costFor` result (0 wei for a first mint by an Agent ID wallet). A batch crossing tiers pays the combined tier sum, which `costFor` already returns.
4. Confirm with `balanceOf(wallet)` (selector `0x70a08231`) on the Stall contract and report the new Stall count.

Notes: the mint is anti-bot protected on chain (the caller must be the wallet itself, which is always true for an Agentic Wallet). Never send more than `costFor` returns; overpayment reverts.

## 2. Join the $AMKT presale

Fixed rate: **1 BNB = 20,000,000 AMKT**. Hardcap 1,000,000,000 AMKT sold. The presale runs 14 days from its on-chain start.

Procedure:

1. Read `isOpen()`, selector `0x47535d7b`, on the presale contract. If false, stop and report the presale status (`startTime()` `0x78e97925`, `endTime()` `0x3197cbb6`).
2. Pay with BNB: call `buyWithBNB()`, selector `0x20f1fc61`, payable with the user's BNB amount as value.
3. Or pay with USDT: call `approve(presaleContract, usdtAmount)` on USDT, selector `0x095ea7b3`, then call `buyWithUSDT(uint256 usdtAmount)`, selector `0xa7c60160`. The contract converts USDT to AMKT at the Chainlink BNB/USD price (`bnbPrice()`, selector `0x576dde12`).
4. Report `bought(wallet)`, selector `0x667022fd`: the AMKT the user can claim after the presale ends.

## 3. Claim $AMKT

Claims open after the presale `endTime()`. See `claim-skill.md` on this site or the claim site at claim.agentmarket.exchange. Both claims are free (no fee) and each can be used once per wallet:

- `claimPresale()`, selector `0x046ef9a5`: pays out the AMKT bought in the presale.
- `claimHolder()`, selector `0x6f19bc8b`: pays 25,000 AMKT per Stall held at claim time.

`claimable(wallet)`, selector `0x402914f5`, returns the combined unclaimed amount.
