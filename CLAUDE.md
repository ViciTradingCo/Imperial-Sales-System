# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

EEC-Sales-System is a "Wheel-And-Spoke" style sales system for the Mereth Skyrim RP server, run by the in-fiction East Empire Trading Company and managed by SmileDaemon on Discord. The domain is roleplay commerce: goods flowing between a central hub ("wheel") and outlying nodes ("spokes").

## Current state

This repository is greenfield. As of this file's creation it contains only `README.md` and an MIT `LICENSE` — no application code, build tooling, dependencies, or tests exist yet. There is intentionally no build/lint/test section here because there is nothing to build, lint, or test.

When you add the first real code, update this file with:
- The chosen stack and how to install, build, run, and test it (including how to run a single test).
- The actual architecture once "wheel" (hub) and "spoke" (node) concepts are expressed in code — how inventory/orders move between them, and where the source of truth lives.
- Any Discord integration details, since the system is operated through Discord.

Do not document commands or architecture speculatively; add them only once they exist in the repo.

## Git workflow

- `main` is the default branch and is protected: never push directly to it without explicit user permission.
- Do the work on a feature branch and push there; open a pull request only when the user asks.
