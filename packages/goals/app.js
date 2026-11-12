/**
 * @fileoverview This is a Goal setting application
 * This file is the entry point into the Goal setting application
 *
 * @author Stephen Booysen
 * @version 1.0.0
 */

'use strict';

const express = require("express");
const cors = require("cors");
const path = require("path");
const expressLayouts = require("express-ejs-layouts");

const app = express();
const port = process.env.PORT || 9201;


const WebDatabase = require("./backend/components/webdatabase.js");


// Define the Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Set up EJS templating
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'public', 'views'));

// Set up express-ejs-layouts
app.use(expressLayouts);
app.set('layout', 'layouts/main');
app.set('layout extractScripts', true);
app.set('layout extractStyles', true);

// The EJS templates live under public/views, which is inside the static root.
// Block direct requests for template source so they are only ever rendered.
app.use((req, res, next) => {
  if (req.path.endsWith('.ejs')) {
    return res.status(404).end();
  }
  next();
});

// Serve static files (CSS, JS, images, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// PWA headers middleware
app.use((req, res, next) => {
  // Add PWA-friendly headers
  if (req.path === '/site.webmanifest') {
    res.setHeader('Content-Type', 'application/manifest+json');
  }
  
  // Service worker should not be cached
  if (req.path === '/sw.js') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  
  // Add security headers for PWA
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  next();
});

// launch our event emitter
const EventEmitter = require('events');
const eventEmitter = new EventEmitter()

// Initiate the service Registry
const serviceRegistry = require('digital-technologies-core');
serviceRegistry.initialize(app, eventEmitter, {
  // The /services dashboards are gated behind an admin login by default. This
  // is a local, single-user desktop app with no auth service, so leave them open.
  security: {
    servicesAuth: { requireLogin: false }
  }
});

const log = serviceRegistry.logger('memory');
const cache = serviceRegistry.cache('memory');
const dataserve = serviceRegistry.dataService('memory');
const filing = serviceRegistry.filing('local');
const queue = serviceRegistry.queue('memory');
const scheduling = serviceRegistry.scheduling('memory');
const searching = serviceRegistry.searching('memory');
const measuring = serviceRegistry.measuring('memory');
const notifying = serviceRegistry.notifying('memory');
const worker = serviceRegistry.working('memory');
const workflow = serviceRegistry.workflow('memory');

// Database instance
const database = new WebDatabase();

// Initialize database and start server
async function startServer() {
  try {
    await database.init();
    
    // Initialize routes and pages after database is ready
    const routes = require("./backend/routes")(app, database);
    const pages = require("./backend/pages")(app);
    
    const server = app.listen(port, () => {
      console.log(`=======================================================`);
      console.log(`Web server running at http://localhost:${port}`);
      console.log(`=======================================================`);
    });

    // Handle server errors
    server.on('error', (error) => {
      if (error.syscall !== 'listen') {
        throw error;
      }

      switch (error.code) {
        case 'EACCES':
          console.error(`Port ${port} requires elevated privileges`);
          process.exit(1);
          break;
        case 'EADDRINUSE':
          console.error(`Port ${port} is already in use`);
          process.exit(1);
          break;
        default:
          throw error;
      }
    });

    // Graceful shutdown handlers
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down gracefully');
      server.close(() => {
        console.log('Server closed');
        if (database && database.db) {
          database.db.close();
        }
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('SIGINT received, shutting down gracefully');
      server.close(() => {
        console.log('Server closed');
        if (database && database.db) {
          database.db.close();
        }
        process.exit(0);
      });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      process.exit(1);
    });

  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
