CREATE TABLE IF NOT EXISTS documents (
  id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  mime_type VARCHAR(255) NOT NULL,
  original_file LONGBLOB NULL,
  file_sha256 CHAR(64) NULL,
  extracted_text LONGTEXT NOT NULL,
  upload_date DATETIME(3) NOT NULL,
  status ENUM('indexing', 'ready', 'error') NOT NULL,
  token_count INT UNSIGNED NULL,
  error_message TEXT NULL,
  pdf_text_extraction_version INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX documents_upload_date_idx (upload_date),
  INDEX documents_status_idx (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS document_chunks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  document_id CHAR(36) NOT NULL,
  chunk_index INT UNSIGNED NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY document_chunks_order_idx (document_id, chunk_index),
  FULLTEXT KEY document_chunks_content_ft (content),
  CONSTRAINT document_chunks_document_fk
    FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
