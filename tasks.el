;; Buffer-local variables for task file paths
(defvar-local task-base-directory nil
  "Base directory for task files (derived from current .tasks file).")

(defvar-local task-file nil
  "File containing outstanding task items.")

(defvar-local task-file-completed nil
  "File containing completed task items.")

(defvar-local task-transactions-file nil
  "File containing task transaction log.")

;; Mode state
(defvar-local task-edit-mode-p nil
  "Non-nil when in task edit mode.")

(defvar-local task-editing-single nil
  "Non-nil when editing a single task in the mode line.")

;; Edit mode keymap (minimal - mostly self-insert)
(defvar task-edit-mode-map
  (let ((map (make-sparse-keymap)))
    ;; Only C-c C-c to exit edit mode
    (define-key map (kbd "C-c C-c") 'task-toggle-edit)
    map)
  "Keymap for task edit mode.")

;; Main mode keymap that switches between view and edit
(defvar task-mode-map
  (make-sparse-keymap)
  "Keymap for task-mode.")

;; Global keybinding
(global-set-key (kbd "C-c C-t") 'task-buffer-display)

;; Mode definition
(defun task-mode ()
  "Major mode for managing tasks with vi-like keybindings."
  (interactive)
  (kill-all-local-variables)
  (setq major-mode 'task-mode)
  (setq mode-name "Todo")
  (setq task-edit-mode-p nil)
  ;; Ensure paths are set up if not already done
  (unless task-base-directory
    (task-setup-paths))
  (use-local-map (task-make-view-mode-map))
  (task-ensure-file-format)
  (setq buffer-read-only t)
  (setq mode-line-format
        (list "-" 'mode-line-mule-info 'mode-line-client 'mode-line-modified
              " " 'buffer-name "   "
              '(:eval (cond 
                       (task-editing-single (concat "Edit: " (or task-editing-text "")))
                       (task-edit-mode-p "Todo-Edit")
                       (t "Todo")))
              '(vc-mode vc-mode)
              " " 'mode-line-modes 'mode-line-misc-info 'mode-line-end-spaces))
  (run-hooks 'task-mode-hook)
  (message "Todo mode enabled"))

;; View mode keymap (default)
(defun task-make-view-mode-map ()
  "Create the view mode keymap fresh each time."
  (let ((map (make-sparse-keymap)))

    ;; Quick create
    (define-key map "0" 'task-create-p0)
    (define-key map "1" 'task-create-p1)
    (define-key map "2" 'task-create-p2)
    (define-key map "3" 'task-create-p3)
    (define-key map "4" 'task-create-p4)

    ;; Update priority
    (define-key map (kbd "C-c 0") 'task-update-p0)
    (define-key map (kbd "C-c 1") 'task-update-p1)
    (define-key map (kbd "C-c 2") 'task-update-p2)
    (define-key map (kbd "C-c 3") 'task-update-p3)
    (define-key map (kbd "C-c 4") 'task-update-p4)

    ;; Edit mode toggle
    (define-key map (kbd "C-c C-c") 'task-toggle-edit)

    ;; Move within priority section
    (define-key map "J" 'task-move-down)
    (define-key map "K" 'task-move-up)
    (define-key map "N" 'task-move-down)
    (define-key map "P" 'task-move-up)

    ;; Navigation
    (define-key map "j" 'task-next-line)
    (define-key map "k" 'task-previous-line)
    (define-key map "n" 'task-next-line)
    (define-key map "p" 'task-previous-line)

    ;; Actions
    (define-key map "a" 'task-create)
    (define-key map "o" 'task-create-pcurrent)
    (define-key map "c" 'task-complete)
    (define-key map "x" 'task-delete)
    (define-key map "e" 'task-edit-single)

    ;; Priority
    (define-key map "," 'task-raise-priority)
    (define-key map "." 'task-lower-priority)

    map))

(defun task-ensure-file-format ()
  "Ensure the task file has the proper section headers, preserving existing content."
  (save-excursion
    (goto-char (point-min))
    (unless (looking-at "Priority 0")
      ;; File doesn't have proper format, initialize it
      (let ((inhibit-read-only t))
        (erase-buffer)
        (insert "Priority 0\n")
        (insert "-------------------------------------------------------------------------------\n")
        (insert "\n")
        (insert "Priority 1\n")
        (insert "-------------------------------------------------------------------------------\n")
        (insert "\n")
        (insert "Priority 2\n")
        (insert "-------------------------------------------------------------------------------\n")
        (insert "\n")
        (insert "Priority 3\n")
        (insert "-------------------------------------------------------------------------------\n")
        (insert "\n")
        (insert "Priority 4\n")
        (insert "-------------------------------------------------------------------------------\n")
        (insert "\n")
        (save-buffer)))))

(defun task-buffer-display ()
  "Display the task buffer and activate task-mode."
  (interactive)
  ;; Use ~/.tasks/current.tasks as default
  (let ((default-task-file "~/.tasks/current.tasks"))
    (task-open-file default-task-file)))

(defun task-open-file (filename)
  "Open FILENAME as a task file and activate task-mode."
  (interactive "fOpen task file: ")
  (let ((task-buffer (get-file-buffer filename)))
    (if task-buffer
        (switch-to-buffer task-buffer)
      (find-file filename))
    ;; Set up task file paths and activate task major mode
    (task-setup-paths)
    (task-mode)))

(defun task-setup-paths ()
  "Set up task file paths based on current buffer's file name."
  (let ((file-name (buffer-file-name)))
    (if file-name
        (let* ((task-file-path file-name)
               (base-dir (file-name-directory task-file-path)))
          (setq task-base-directory base-dir)
          (setq task-file task-file-path)
          (setq task-file-completed (expand-file-name "completed.yaml" base-dir))
          (setq task-transactions-file (expand-file-name "transactions.yaml" base-dir))
          (message "Task paths set up for: %s" base-dir))
      ;; Fallback to default paths if no file name
      (setq task-base-directory "~/.tasks/")
      (setq task-file "~/.tasks/current.tasks")
      (setq task-file-completed "~/.tasks/completed.yaml")
      (setq task-transactions-file "~/.tasks/transactions.yaml")
      (message "Using default task paths: ~/.tasks/"))))

;;=============================================================================
;; Todo mode functions
;;=============================================================================

(defun task-create-p0 (&optional insertFirst)
  "Create a priority 0 task."
  (interactive)
  (let ((description (read-from-minibuffer "Description: ")))
    (task-create "0" description (if insertFirst insertFirst t))))

(defun task-create-p1 (&optional insertFirst)
  "Create a priority 1 task."
  (interactive)
  (let ((description (read-from-minibuffer "Description: ")))
    (task-create "1" description (if insertFirst insertFirst t))))

(defun task-create-p2 (&optional insertFirst)
  "Create a priority 2 task."
  (interactive)
  (let ((description (read-from-minibuffer "Description: ")))
    (task-create "2" description (if insertFirst insertFirst t))))

(defun task-create-p3 (&optional insertFirst)
  "Create a priority 3 task."
  (interactive)
  (let ((description (read-from-minibuffer "Description: ")))
    (task-create "3" description (if insertFirst insertFirst t))))

(defun task-create-p4 (&optional insertFirst)
  "Create a priority 4 task."
  (interactive)
  (let ((description (read-from-minibuffer "Description: ")))
    (task-create "4" description (if insertFirst insertFirst t))))

(defun task-create (&optional priority description insertFirst due-date)
  "Create a new task item with PRIORITY and DESCRIPTION.
If INSERTFIRST is explicitly nil, insert at current position; otherwise insert at top of section."
  (interactive)
  (let* ((priority (or priority
                       (completing-read "Priority (1-4): " '("1" "2" "3" "4") nil t)))
         (description (or description
                          (read-from-minibuffer "Description: "))))

    ;; Validate inputs
    (when (or (not description) (string= description ""))
      (error "Description cannot be empty"))

    (when (not (member priority '("0" "1" "2" "3" "4")))
      (error "Priority must be 0, 1, 2, 3, or 4"))

    ;; Create the task line
    (let ((task-line description)
          (inhibit-read-only t))
      (if (not (eq insertFirst nil))
          ;; Insert at top of priority section (original behavior)
          (let ((insert-point (task-find-priority-section priority)))
            (if insert-point
                (progn
                  (goto-char insert-point)
                  (open-line 1)
                  (insert task-line)
                  (beginning-of-line)
                  (save-buffer)
                  ;; Log the task creation
                  (task-log-task-created task-line priority)
                  (message "Todo added to Priority %s: %s" priority task-line))
              (error "Could not find Priority %s section" priority)))
        ;; Insert at current position
        (progn
          (open-line 1)
          (insert task-line)
          (beginning-of-line)
          (save-buffer)
          ;; Log the task creation
          (task-log-task-created task-line priority)
          (message "Todo added to Priority %s: %s" priority task-line))))))

(defun task-create-pcurrent ()
  "Create a task item in the current priority section at current position."
  (interactive)
  (cond
   ;; If on priority header or separator, do nothing
   ((or (looking-at "^Priority [0-9]")
        (looking-at "^-+$"))
    (message "Cannot create task on header or separator line"))

   ;; Otherwise, find current priority and create item
   (t
    (let ((current-priority (task-get-current-priority)))
      (if current-priority
          (cond
           ((string= current-priority "1") (task-create-p1 nil))
           ((string= current-priority "2") (task-create-p2 nil))
           ((string= current-priority "3") (task-create-p3 nil))
           ((string= current-priority "4") (task-create-p4 nil)))
        (message "Could not determine current priority section"))))))

(defun task-update-p0 ()
  "Update current task to priority 0."
  (interactive)
  (task-update-priority "0"))

(defun task-update-p1 ()
  "Update current task to priority 1."
  (interactive)
  (task-update-priority "1"))

(defun task-update-p2 ()
  "Update current task to priority 2."
  (interactive)
  (task-update-priority "2"))

(defun task-update-p3 ()
  "Update current task to priority 3."
  (interactive)
  (task-update-priority "3"))

(defun task-update-p4 ()
  "Update current task to priority 4."
  (interactive)
  (task-update-priority "4"))

(defun task-raise-priority ()
  "Raise priority of current task by 1 (lower number = higher priority)."
  (interactive)
  (let ((current-priority (task-get-current-priority)))
    (when (and current-priority (> (string-to-number current-priority) 0))
      (let ((new-priority (number-to-string (1- (string-to-number current-priority)))))
        (task-update-priority new-priority)))))

(defun task-lower-priority ()
  "Lower priority of current task by 1 (higher number = lower priority)."
  (interactive)
  (let ((current-priority (task-get-current-priority)))
    (when (and current-priority (< (string-to-number current-priority) 4))
      (let ((new-priority (number-to-string (1+ (string-to-number current-priority)))))
        (task-update-priority new-priority)))))

(defun task-update-priority (priority)
  "Update the priority of the current task item to PRIORITY."
  (beginning-of-line)
  (when (looking-at-task)
    (let ((current-position (point))
          (old-priority (task-get-current-priority))
          (item-text (buffer-substring-no-properties
                     (line-beginning-position)
                     (line-end-position)))
          (inhibit-read-only t))
      (kill-whole-line)
      (goto-char (task-find-priority-section priority))
      (yank)
      ;; Log the priority change
      (task-log-priority-change item-text old-priority priority)
      (goto-char current-position)
      ;; Move to next item, or first item of next priority if no more items
      (if (looking-at-task)
          ;; There's another item at current position, stay here
          (beginning-of-line)
        ;; No item at current position, find next item
        (while (and (not (eobp)) (not (looking-at-task)))
          (forward-line 1))
        (when (eobp)
          ;; Reached end, go to last task item
          (while (and (not (bobp)) (not (looking-at-task)))
            (forward-line -1)))
        (beginning-of-line))
      (save-buffer)
      (message "Todo moved to priority %s" priority))))

(defun task-next-line ()
  "Move to next task item, skipping headers, separators, and blank lines."
  (interactive)
  (forward-line 1)
  (while (and (not (eobp)) (not (looking-at-task)))
    (forward-line 1))
  (when (eobp)
    ;; Reached end, go to last task item
    (while (and (not (bobp)) (not (looking-at-task)))
      (forward-line -1)))
  (beginning-of-line))

(defun task-previous-line ()
  "Move to previous task item, skipping headers, separators, and blank lines."
  (interactive)
  (forward-line -1)
  (while (and (not (bobp)) (not (looking-at-task)))
    (forward-line -1))
  (when (bobp)
    ;; Reached beginning, go to first task item
    (while (and (not (eobp)) (not (looking-at-task)))
      (forward-line 1)))
  (beginning-of-line))

(defun task-toggle-edit ()
  "Toggle between edit and view modes."
  (interactive)
  (if task-edit-mode-p
      ;; Exit edit mode
      (progn
        (setq task-edit-mode-p nil)
        (setq buffer-read-only t)
        (use-local-map (task-make-view-mode-map))
        (force-mode-line-update)
        (message "Exiting edit mode"))
    ;; Enter edit mode
    (setq task-edit-mode-p t)
    (setq buffer-read-only nil)
    (use-local-map task-edit-mode-map)
    (force-mode-line-update)
    (message "Entering edit mode (C-c C-c to exit)")))

(defun task-edit-single ()
  "Edit the current task in the mode line."
  (interactive)
  (when (looking-at-task)
    (let* ((current-text (buffer-substring-no-properties
                         (line-beginning-position)
                         (line-end-position)))
           (task-id (format "%s:%d" (buffer-name) (line-number-at-pos))))
      (setq task-editing-single t)
      (setq task-editing-text current-text)
      (setq task-editing-id task-id)
      (force-mode-line-update)
      (let ((new-text (let ((minibuffer-setup-hook
                             (cons (lambda () (goto-char (minibuffer-prompt-end)))
                                   minibuffer-setup-hook)))
                        (read-from-minibuffer "Edit task: " current-text))))
        (when (and new-text (not (string= new-text current-text)))
          (let ((inhibit-read-only t))
            (task-log-task-name-updated current-text new-text)
            (delete-region (line-beginning-position) (line-end-position))
            (insert new-text)
            (save-buffer)
            (message "Task updated"))))
      (setq task-editing-single nil)
      (setq task-editing-text nil)
      (setq task-editing-id nil)
      (force-mode-line-update)
      (beginning-of-line))))


(defun task-append-completed-yaml (task-name completion-date)
  "Append a completed task to the YAML completed file."
  (let ((yaml-file task-file-completed))
    (unless (file-exists-p yaml-file)
      ;; Create the file with initial YAML structure
      (with-temp-buffer
        (insert "completed:\n")
        (write-file yaml-file)))
    
    ;; Read current content or create new structure
    (let* ((yaml-content (if (file-exists-p yaml-file)
                            (with-temp-buffer
                              (insert-file-contents yaml-file)
                              (buffer-string))
                          "completed:\n"))
           (new-entry (format "  - name: %s\n    date: %s\n" task-name completion-date)))
      
      ;; Append the new entry
      (with-temp-buffer
        (insert yaml-content)
        (goto-char (point-max))
        (unless (looking-at "^$")
          (insert "\n"))
        (insert new-entry)
        (write-file yaml-file)))))

(defun task-complete ()
  "Mark the current task as done and move it to completed file."
  (interactive)
  ;; Ensure paths are set up
  (unless task-file-completed
    (task-setup-paths))
  (save-excursion
    (beginning-of-line)
    (when (and (not (looking-at "^Priority [0-9]"))
               (not (looking-at "^-+$"))
               (not (looking-at "^$")))
      ;; We're on a task item line
      (let* ((line-start (point))
             (line-end (progn (end-of-line) (point)))
             (task-line (buffer-substring line-start line-end))
             (task-buffer (current-buffer))
             (completion-date (get-completion-date)))

        ;; Log the task completion before deleting
        (task-log-task-completed task-line)

        ;; Delete the task line from current buffer
        (let ((inhibit-read-only t))
          (delete-region line-start (min (+ 1 line-end) (point-max)))
          (save-buffer))

        ;; Add to completed YAML file
        (task-append-completed-yaml task-line completion-date)

        (message "Todo completed")))))

(defun task-delete ()
  "Delete the current task item and log it to YAML."
  (interactive)
  (save-excursion
    (beginning-of-line)
    (when (looking-at-task)
      ;; We're on a task item line
      (let* ((line-start (point))
             (line-end (progn (end-of-line) (point)))
             (task-line (buffer-substring line-start line-end)))

        ;; Log the task deletion before deleting
        (task-log-task-deleted task-line)

        ;; Delete the task line from current buffer
        (let ((inhibit-read-only t))
          (delete-region line-start (min (+ 1 line-end) (point-max)))
          (save-buffer)
          (message "Todo deleted: %s" task-line))))))

(defun task-move-down ()
  "Move current task down one position."
  (interactive)
  (beginning-of-line)
  (when (looking-at-task)
    ;; Check if we're the last item in Priority 4 section
    (let ((in-priority-4 (string= (task-get-current-priority) "4"))
          (is-last-in-p4 (save-excursion
                           (forward-line 1)
                           (while (and (not (eobp)) (not (looking-at-task)))
                             (forward-line 1))
                           (eobp))))

      (if (and in-priority-4 is-last-in-p4)
          (message "Cannot move down - already at last item")
        (let ((inhibit-read-only t))
          ;; 1. Cut the task item (without the newline)
          (kill-line)
          (delete-char 1)  ; Delete the newline separately

          ;; 2. Move to next line
          (forward-line 0)  ; Stay at current position after kill-whole-line

          ;; 3. Find insertion point and insert
          (if (looking-at-task)
              ;; Next line is a task - go to end of line, return, paste
              (progn
                (end-of-line)
                (newline)
                (yank)
                ;; Cursor is now at end of inserted line, move to beginning
                (beginning-of-line))
            ;; Next line is not a task - find first line of new priority section
            (progn
              ;; Skip non-task lines until we find a priority section
              (while (and (not (eobp)) (not (looking-at "^Priority [0-9]")))
                (forward-line 1))
              ;; Go to insertion point (2 lines down from priority header)
              (forward-line 2)
              (open-line 1)
              (yank)
              ;; Cursor is now at end of inserted line, move to beginning
              (beginning-of-line))))))))

(defun task-move-up ()
  "Move current task up one position."
  (interactive)
  (beginning-of-line)
  (when (looking-at-task)

    ;; 1. Check if 2 lines above is Priority 0 line
    (let ((two-lines-up (save-excursion
                          (forward-line -2)
                          (looking-at "^Priority 0$"))))
      (if two-lines-up
          (message "Cannot move up - already at first item")
        (let ((inhibit-read-only t))
          ;; 2. Cut the item
          (kill-line)
          (delete-char 1)  ; Delete the newline separately

          ;; 3. Check what's on the prior line
          (forward-line -1)
          (if (looking-at-task)
              ;; Prior line is a task item - paste before it
              (progn
                (beginning-of-line)
                (open-line 1)
                (yank)
                (beginning-of-line))

            ;; Prior line is separator - move to priority line, then blank line, paste
            (progn
              (forward-line -3)  ; Move to priority line
              (forward-line 1)   ; Move to blank line after priority
              (open-line 1)
              (yank)
              (beginning-of-line))))))))

;;=============================================================================
;; Utilities
;;=============================================================================

;; Helper function to check if current line is a task item
(defun looking-at-task ()
  "Return t if current line is a task item (not header, separator, or blank)."
  (save-excursion
    (beginning-of-line)
    (and (not (looking-at "^Priority [0-9]"))  ; Not a priority header
         (not (looking-at "^-+$"))             ; Not a separator line
         (not (looking-at "^$")))))            ; Not a blank line

(defun task-find-priority-section (priority)
  "Find the insertion point for the given priority section."
  (save-excursion
    (goto-char (point-min))
    (re-search-forward (concat "^Priority " priority "$"))
    (forward-line 2)  ; Skip header and separator line
    (beginning-of-line)
    (point)))

(defun task-get-current-priority ()
  "Get the priority number of the current item based on which section it's in."
  (save-excursion
    (let ((current-pos (point)))
      (goto-char (point-min))
      (cond
       ((and (re-search-forward "^Priority 0$" nil t)
             (< (point) current-pos)
             (or (not (re-search-forward "^Priority 1$" nil t))
                 (> (point) current-pos)))
        "0")
       ((and (goto-char (point-min))
             (re-search-forward "^Priority 1$" nil t)
             (< (point) current-pos)
             (or (not (re-search-forward "^Priority 2$" nil t))
                 (> (point) current-pos)))
        "1")
       ((and (goto-char (point-min))
             (re-search-forward "^Priority 2$" nil t)
             (< (point) current-pos)
             (or (not (re-search-forward "^Priority 3$" nil t))
                 (> (point) current-pos)))
        "2")
       ((and (goto-char (point-min))
             (re-search-forward "^Priority 3$" nil t)
             (< (point) current-pos)
             (or (not (re-search-forward "^Priority 4$" nil t))
                 (> (point) current-pos)))
        "3")
       ((and (goto-char (point-min))
             (re-search-forward "^Priority 4$" nil t)
             (< (point) current-pos))
        "4")
       (t nil)))))

(defun get-date ()
  "Get current date in MM/DD format."
  (let* ((current-date (current-time-string))
         (month (substring current-date 4 7))
         (day (substring current-date 8 10)))

    (if (eq ?  (aref day 0))
        (setq day (concat "0" (substring day 1))))

    (cond
     ((equal month "Jan") (concat "01/" day))
     ((equal month "Feb") (concat "02/" day))
     ((equal month "Mar") (concat "03/" day))
     ((equal month "Apr") (concat "04/" day))
     ((equal month "May") (concat "05/" day))
     ((equal month "Jun") (concat "06/" day))
     ((equal month "Jul") (concat "07/" day))
     ((equal month "Aug") (concat "08/" day))
     ((equal month "Sep") (concat "09/" day))
     ((equal month "Oct") (concat "10/" day))
     ((equal month "Nov") (concat "11/" day))
     ((equal month "Dec") (concat "12/" day)))))

(defun get-completion-date ()
  "Get current date in M/D/YYYY format for completion entries."
  (let* ((time (current-time))
         (month (string-to-number (format-time-string "%m" time)))
         (day (string-to-number (format-time-string "%d" time)))
         (year (format-time-string "%Y" time)))
    (format "%d/%d/%s" month day year)))

(defun get-iso-timestamp ()
  "Get current date and time in ISO 8601 format."
  (format-time-string "%Y-%m-%dT%H:%M:%S%z"))

(defun task-ensure-yaml-file (log-file)
  "Ensure the YAML log file exists with proper structure."
  (unless (file-exists-p log-file)
    (with-temp-buffer
      (insert "# Entries are append-only, ordered chronologically\n")
      (insert "entries:\n")
      (write-file log-file))))

(defun task-log-priority-change (item old-priority new-priority)
  "Log a priority change to transactions.yaml file."
  (let ((log-file (or task-transactions-file "~/.tasks/transactions.yaml"))
        (timestamp (get-iso-timestamp)))
    (task-ensure-yaml-file log-file)
    (with-temp-buffer
      (insert (format "  - type: update-priority\n"))
      (insert (format "    timestamp: %s\n" timestamp))
      (insert (format "    name: \"%s\"\n" item))
      (insert (format "    old-priority: %s\n" old-priority))
      (insert (format "    new-priority: %s\n" new-priority))
      (insert (format "    source: task.el\n\n"))
      (append-to-file (point-min) (point-max) log-file))))

(defun task-log-task-created (item priority)
  "Log a task creation to transactions.yaml file."
  (let ((log-file (or task-transactions-file "~/.tasks/transactions.yaml"))
        (timestamp (get-iso-timestamp)))
    (task-ensure-yaml-file log-file)
    (with-temp-buffer
      (insert (format "  - type: create\n"))
      (insert (format "    timestamp: %s\n" timestamp))
      (insert (format "    name: \"%s\"\n" item))
      (insert (format "    priority: %s\n" priority))
      (insert (format "    source: task.el\n\n"))
      (append-to-file (point-min) (point-max) log-file))))

(defun task-log-task-completed (item &optional comments)
  "Log a task completion to transactions.yaml file."
  (let ((log-file (or task-transactions-file "~/.tasks/transactions.yaml"))
        (timestamp (get-iso-timestamp)))
    (task-ensure-yaml-file log-file)
    (with-temp-buffer
      (insert (format "  - type: complete\n"))
      (insert (format "    timestamp: %s\n" timestamp))
      (insert (format "    name: \"%s\"\n" item))
      (insert (format "    source: task.el\n\n"))
      (append-to-file (point-min) (point-max) log-file))))

(defun task-log-task-deleted (item)
  "Log a task deletion to transactions.yaml file."
  (let ((log-file (or task-transactions-file "~/.tasks/transactions.yaml"))
        (timestamp (get-iso-timestamp)))
    (task-ensure-yaml-file log-file)
    (with-temp-buffer
      (insert (format "  - type: remove\n"))
      (insert (format "    timestamp: %s\n" timestamp))
      (insert (format "    name: \"%s\"\n" item))
      (insert (format "    source: task.el\n\n"))
      (append-to-file (point-min) (point-max) log-file))))

(defun task-log-task-name-updated (old-name new-name)
  "Log a task name update to transactions.yaml file."
  (let ((log-file (or task-transactions-file "~/.tasks/transactions.yaml"))
        (timestamp (get-iso-timestamp)))
    (task-ensure-yaml-file log-file)
    (with-temp-buffer
      (insert (format "  - type: update-name\n"))
      (insert (format "    timestamp: %s\n" timestamp))
      (insert (format "    name: \"%s\"\n" old-name))
      (insert (format "    new-name: \"%s\"\n" new-name))
      (insert (format "    source: task.el\n\n"))
      (append-to-file (point-min) (point-max) log-file))))

;; Development helper function
(defun task-reload ()
  "Reload task mode definitions and refresh current buffer."
  (interactive)
  (eval-buffer)
  ;; Clear the cached keymap so it gets rebuilt
  (setq task-mode-map nil)
  ;; Reactivate the mode
  (when (eq major-mode 'task-mode)
    (task-mode)))

;;;###autoload
(add-to-list 'auto-mode-alist '("\.tasks\'" . task-mode-for-tasks-file))

(defun task-mode-for-tasks-file ()
  "Enable task-mode for .tasks files."
  (task-setup-paths)
  (task-mode))

(provide 'task)
;;; task.el ends here
