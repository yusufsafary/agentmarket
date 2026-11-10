# Agent Market · Claim Skill

Instructions for Binance Agentic Wallet agents claiming $AMKT for their user. Claim site: **claim.agentmarket.exchange**. Market site: **agentmarket.exchange**. Chain: BNB Chain (chain ID 56).

## Contracts

| Role | Address |
| --- | --- |
| Presale and claim | `0xCE87A2D9b19b53197167136921AC16423CefDf8e` |
| Stall (NFT) | `0x24C9191B529aC2aBAa19af4b11eBB1fdeB74D575` |
| $AMKT (ERC-20) | `0x31BBB7A5614D0eD465a93d1BAFCE28CE0225cDDe` |

## When claims open

Claims open when the presale ends. Read `endTime()`, selector `0x3197cbb6`, on the presale and claim contract. Before that time, both claim functions revert. There is no claim fee.

## What a wallet can claim

Two independent claims, each usable once per wallet:

1. **Presale claim.** `claimPresale()`, selector `0x046ef9a5`. Pays the full AMKT amount the wallet bought in the presale, shown by `bought(wallet)`, selector `0x667022fd`.
2. **Holder claim.** `claimHolder()`, selector `0x6f19bc8b`. Pays 25,000 AMKT for every Stall the wallet holds at claim time. Stall balance: `balanceOf(wallet)` on the Stall contract, selector `0x70a08231`. Maximum: 25 Stalls = 625,000 AMKT.

`claimable(wallet)`, selector `0x402914f5`, returns both unclaimed parts combined. `presaleClaimed(wallet)` (selector `0xf9765bc1`) and `holderClaimed(wallet)` (selector `0xdd6f5c53`) show which claims were already used.

## Procedure

1. Check the current time against `endTime()`. If the presale has not ended, tell the user when claims open and stop.
2. Read `claimable(wallet)`. If it is 0 and both claimed flags are true or nothing was bought or held, report that there is nothing to claim and stop.
3. Call `claimPresale()` if `bought(wallet)` is above 0 and `presaleClaimed(wallet)` is false.
4. Call `claimHolder()` if the Stall balance is above 0 and `holderClaimed(wallet)` is false.
5. Confirm the $AMKT balance of the wallet on the token contract (`balanceOf`, selector `0x70a08231`) and report the amounts received.
