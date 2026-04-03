# Markdown Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add unified Markdown rendering for user/assistant messages plus desktop split preview and mobile edit/preview tabs.

**Architecture:** Keep the existing single-page chat UI, extract Markdown rendering and composer-preview logic into dedicated browser scripts, and wire both message rendering and draft preview through the same renderer. Preserve current send/mention flows while moving mention highlighting to a safer post-render enhancement step.

**Tech Stack:** TypeScript server build, static browser JS/CSS in `public/`, Node test runner integration tests.

---
