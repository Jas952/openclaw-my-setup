# Infrastructure Notes

This directory is kept in the repository as a pointer to the external infrastructure source used while building our OpenClaw workspace.

Upstream repository used as the base infrastructure layer:

- https://github.com/openclaw/openclaw

What matters here:

- the contents of `openclaw-2026.3.13/` are not published in the main repository;
- this layer is treated as an external base, not as the central part of our authored public release;
- the main GitHub page should link back to the original source.

Why:

- this directory contains external code and infrastructure that we do not want to mix with our own public release;
- the main repository should focus on our workspace, configuration, documentation, and application-level work.

In this repository, the infrastructure layer is shown only as a link and as usage context. The main focus here is our workspace, interface, application modules, and real user workflows built on top of OpenClaw.
