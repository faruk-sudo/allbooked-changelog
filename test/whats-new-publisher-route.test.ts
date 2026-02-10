import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { AppConfig } from "../src/config";
import { loadConfig } from "../src/config";
import { InMemoryChangelogRepository } from "../src/changelog/repository";

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 3000,
    whatsNewKillSwitch: false,
    allowlistEnabled: true,
    allowlistedTenantIds: new Set(["tenant-alpha"]),
    publisherAllowlistedUserIds: new Set(["publisher-1"]),
    publisherAllowlistedEmails: new Set(),
    devAuthBypassEnabled: false,
    devAuthBypassUserId: "dev-admin-1",
    devAuthBypassUserRole: "ADMIN",
    devAuthBypassTenantId: "tenant-alpha",
    ...overrides
  };
}

function withHeaders(req: request.Test, overrides?: { userId?: string; role?: string; tenantId?: string }) {
  return req
    .set("x-user-id", overrides?.userId ?? "publisher-1")
    .set("x-user-role", overrides?.role ?? "ADMIN")
    .set("x-tenant-id", overrides?.tenantId ?? "tenant-alpha");
}

describe("What's New publisher admin route", () => {
  it("serves /admin/whats-new for publisher-allowlisted admin", async () => {
    const app = createApp(createConfig(), { changelogRepository: new InMemoryChangelogRepository() });

    const response = await withHeaders(request(app).get("/admin/whats-new"));

    expect(response.status).toBe(200);
    expect(response.text).toContain("What's New Publisher");
    expect(response.text).toContain('id="whats-new-admin-status-filter"');
    expect(response.text).toContain('id="whats-new-admin-scope-filter"');
    expect(response.text).toContain('id="whats-new-admin-search-input"');
    expect(response.text).toContain('href="/admin/whats-new/new"');
  });

  it("blocks admin users outside publisher allowlist with safe 404", async () => {
    const app = createApp(createConfig(), { changelogRepository: new InMemoryChangelogRepository() });

    const response = await withHeaders(request(app).get("/admin/whats-new"), {
      userId: "admin-not-publisher"
    });

    expect(response.status).toBe(404);
  });

  it("blocks non-admin users", async () => {
    const app = createApp(createConfig(), { changelogRepository: new InMemoryChangelogRepository() });

    const response = await withHeaders(request(app).get("/admin/whats-new"), {
      role: "USER"
    });

    expect(response.status).toBe(403);
  });

  it("blocks tenants outside allowlist", async () => {
    const app = createApp(createConfig(), { changelogRepository: new InMemoryChangelogRepository() });

    const response = await withHeaders(request(app).get("/admin/whats-new"), {
      tenantId: "tenant-beta"
    });

    expect(response.status).toBe(404);
  });

  it("serves create and edit draft routes", async () => {
    const app = createApp(createConfig(), {
      changelogRepository: new InMemoryChangelogRepository([
        {
          id: "post-123",
          tenantId: "tenant-alpha",
          visibility: "authenticated",
          status: "draft",
          category: "new",
          title: "Draft title",
          slug: "draft-title",
          bodyMarkdown: "",
          publishedAt: null,
          revision: 1
        }
      ])
    });

    const createResponse = await withHeaders(request(app).get("/admin/whats-new/new"));
    expect(createResponse.status).toBe(200);
    expect(createResponse.text).toContain("Create draft");
    expect(createResponse.text).toContain('id="whats-new-editor-form"');
    expect(createResponse.text).toContain('id="whats-new-editor-preview"');
    expect(createResponse.text).toContain('id="whats-new-editor-save-button"');
    expect(createResponse.text).toContain('id="whats-new-editor-publish-button"');
    expect(createResponse.text).toContain('id="whats-new-editor-validation-summary"');

    const editResponse = await withHeaders(request(app).get("/admin/whats-new/post-123/edit"));
    expect(editResponse.status).toBe(200);
    expect(editResponse.text).toContain("Edit draft");
    expect(editResponse.text).toContain('data-mode="edit"');
    expect(editResponse.text).toContain('id="whats-new-editor-status-pill"');
    expect(editResponse.text).toContain('id="whats-new-editor-view-link"');
    expect(editResponse.text).toContain('id="whats-new-editor-confirm-dialog"');
    expect(editResponse.text).toContain('id="whats-new-editor-confirm-submit"');

    const missingEditResponse = await withHeaders(request(app).get("/admin/whats-new/missing/edit"));
    expect(missingEditResponse.status).toBe(404);
  });

  it("serves editor client script with publish confirmation and slug-conflict handling hooks", async () => {
    const app = createApp(createConfig(), { changelogRepository: new InMemoryChangelogRepository() });
    const response = await withHeaders(request(app).get("/admin/whats-new/assets/editor-client.js"));

    expect(response.status).toBe(200);
    expect(response.text).toContain("openConfirmDialog");
    expect(response.text).toContain("Save & Publish");
    expect(response.text).toContain("Slug already in use.");
    expect(response.text).toContain("Try suggested slug:");
  });

  it("supports browser access to /admin/whats-new with dev auth bypass and no explicit publisher allowlist", async () => {
    const config = loadConfig({
      NODE_ENV: "development",
      WHATS_NEW_ALLOWLIST_ENABLED: "true",
      WHATS_NEW_ALLOWLIST_TENANT_IDS: "tenant-alpha",
      WHATS_NEW_DEV_AUTH_BYPASS: "true",
      WHATS_NEW_DEV_USER_ID: "dev-admin-local",
      WHATS_NEW_DEV_USER_ROLE: "ADMIN",
      WHATS_NEW_DEV_TENANT_ID: "tenant-alpha",
      WHATS_NEW_PUBLISHER_ALLOWLIST_USER_IDS: "",
      WHATS_NEW_PUBLISHER_ALLOWLIST_EMAILS: ""
    });

    const app = createApp(config, { changelogRepository: new InMemoryChangelogRepository() });
    const response = await request(app).get("/admin/whats-new");

    expect(response.status).toBe(200);
    expect(response.text).toContain("What's New Publisher");
  });
});
