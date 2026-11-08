const request = require("supertest");
const app = require("../server");
const pool = require("../db");
describe("Appointments API Endpoint Tests", () => {
  // [Cold start fix] The uptime monitor and the site's wake-up call depend on this endpoint
  describe("GET /health", () => {
    it("returns 200 and is never cached", async () => {
      const response = await request(app).get("/health");
      expect(response.statusCode).toBe(200);
      expect(response.body.status).toBe("ok");
      expect(response.headers["cache-control"]).toBe("no-store");
    });
  });

  //checking if the server is running and responding
  describe("GET /api/available-slots", () => {
    it("should return a 200 status and an array of slots when date is provided", async () => {
      const response = await request(app).get(
        "/api/available-slots?date=2026-10-01",
      );

      expect(response.statusCode).toBe(200);
      expect(Array.isArray(response.body)).toBeTruthy(); //
    });
  });

  describe("POST /api/appointments", () => {
    it("should not create an appointment if required fields are missing", async () => {
      const response = await request(app).post("/api/appointments").send({
        client_name: "Test User",
      });

      expect(response.statusCode).not.toBe(201);
    });
  });
});
