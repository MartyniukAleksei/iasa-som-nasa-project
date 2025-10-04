/**
 * Main JavaScript file for global functionality
 * Handles navigation, accessibility, and shared features
 */

// Mobile navigation toggle
document.addEventListener("DOMContentLoaded", () => {
  const navToggle = document.querySelector(".nav-toggle");
  const mainNav = document.querySelector(".main-nav");

  if (navToggle && mainNav) {
    navToggle.addEventListener("click", () => {
      mainNav.classList.toggle("active");
      const isExpanded = mainNav.classList.contains("active");
      navToggle.setAttribute("aria-expanded", isExpanded);
    });

    // Close nav when clicking outside
    document.addEventListener("click", (e) => {
      if (!navToggle.contains(e.target) && !mainNav.contains(e.target)) {
        mainNav.classList.remove("active");
        navToggle.setAttribute("aria-expanded", "false");
      }
    });

    // Close nav when pressing Escape
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && mainNav.classList.contains("active")) {
        mainNav.classList.remove("active");
        navToggle.setAttribute("aria-expanded", "false");
        navToggle.focus();
      }
    });
  }

  // Highlight active navigation link
  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  const navLinks = document.querySelectorAll(".main-nav a");

  navLinks.forEach((link) => {
    const linkPage = link.getAttribute("href");
    if (linkPage === currentPage) {
      link.setAttribute("aria-current", "page");
      link.style.textDecoration = "underline";
    }
  });
});

/**
 * Utility: Format file size for human readability
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted file size
 */
function formatFileSize(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

/**
 * Utility: Show alert message
 * @param {string} message - Message to display
 * @param {string} type - Alert type (error, success, warning, info)
 * @param {HTMLElement} container - Container to append alert to
 */
function showAlert(message, type = "info", container = document.body) {
  const alert = document.createElement("div");
  alert.className = `alert alert-${type}`;
  alert.setAttribute("role", "alert");
  alert.innerHTML = `
    <span>${message}</span>
  `;

  container.insertBefore(alert, container.firstChild);

  // Auto-remove after 5 seconds
  setTimeout(() => {
    alert.style.opacity = "0";
    alert.style.transition = "opacity 0.3s ease";
    setTimeout(() => alert.remove(), 300);
  }, 5000);
}

/**
 * Utility: Validate file before upload
 * @param {File} file - File to validate
 * @param {Array<string>} allowedTypes - Allowed MIME types
 * @param {number} maxSize - Maximum file size in bytes
 * @returns {Object} Validation result
 */
function validateFile(file, allowedTypes, maxSize) {
  const result = {
    valid: true,
    errors: [],
  };

  // Check file size
  if (file.size > maxSize) {
    result.valid = false;
    result.errors.push(
      `File size (${formatFileSize(
        file.size
      )}) exceeds maximum allowed size (${formatFileSize(maxSize)})`
    );
  }

  // Check file type
  const fileExtension = "." + file.name.split(".").pop().toLowerCase();
  const mimeType = file.type;

  const isValidType = allowedTypes.some((type) => {
    if (type.startsWith(".")) {
      return fileExtension === type;
    }
    return mimeType === type || mimeType.startsWith(type.replace("/*", ""));
  });

  if (!isValidType) {
    result.valid = false;
    result.errors.push(
      `File type not supported. Accepted formats: ${allowedTypes.join(", ")}`
    );
  }

  return result;
}

// Export utilities for use in other modules
if (typeof window !== "undefined") {
  window.utils = {
    formatFileSize,
    showAlert,
    validateFile,
  };
}
