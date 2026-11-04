# NAQAH | ناقة

Private camel-ranch operations through an AI voice agent: the worker calls on an ordinary phone, NAQAH asks the
owner's questions, keeps only the facts, updates the farm, and then calls the owner with only what matters.

**Peace of mind, without the busyness. — اطمئنان، دون انشغال**

This repository is the **investor MVP**: a bilingual (Arabic-first, RTL) website with a live, fully simulated demo.
No phone calls are placed, nothing is recorded, nothing is charged, and all demo data stays in the visitor's browser.

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # business rules + conversation engine
npm run typecheck && npm run lint && npm run build
```

**Start with [`AGENT.md`](./AGENT.md)**. It covers the product rules, architecture, conventions, open decisions, and
the roadmap to production (Supabase schema in `supabase/migrations`, telephony, auth).
