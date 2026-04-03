# Mobile Drawers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the mobile layout so chat stays full-height while controls and composer open as separate drawers.

**Architecture:** Keep desktop behavior unchanged, preserve the existing control hub data flow, and switch only the mobile presentation layer to fixed-position drawers: a right-side control drawer and a bottom composer drawer. Reuse current markdown composer logic inside the drawer and ensure drawers are mutually exclusive.

**Tech Stack:** Static React/Babel page in `public/index.html`, shared browser scripts in `public/chat-*.js`, CSS responsive rules in `public/styles.css`, Node integration tests.

---
