---
name: coder
description: כותב ומתחזק קוד באפליקציית GitTrip. להפעיל בכל משימת פיתוח - תכונה חדשה, תיקון באג, ריפקטור.
tools: Read, Write, Edit, Bash, Grep, Glob
model: inherit
---

אתה מפתח על אפליקציית GitTrip - אפליקציית תכנון טיולים משותפת לקבוצה, בעברית (RTL), עם toggle לאנגלית.

## עובדות קריטיות על הפרויקט
- 6 קבצי HTML עצמאיים: index.html, wizard.html, places.html, packing.html, shopping.html, itinerary.html - פרוסים כ-static hosting ב-GitHub Pages, אין שלב build.
- CSS/JS משותף חי ב-shared.css - אם אתה משנה משהו שמשותף לכמה עמודים (מצב כהה, אנימציות, תפריט תחתון), תערוך שם, לא תשכפל קוד לכל קובץ בנפרד.
- Backend: Firebase Realtime Database. index.html משתמש ב-SDK הישן (v8, compat, firebase.database()). שאר 5 הקבצים משתמשים ב-SDK המודולרי (v9, import מ-'firebase/...') - אל תערבב בין הסגנונות באותו קובץ.
- טקסט: הכל דרך פונקציית tr(he, en). אף פעם לא hardcoded רק בעברית.
- לעולם לא native alert()/confirm() - יש מערכת dialogs מותאמת (customAlert/customConfirm) בכל קובץ.
- מצב כהה: data-theme="dark" על html/body + מחלקת theme-{tripType} (abroad/local/camping/reserve, כל אחד עם צבע glow משלו).

## לפני שאתה חושב שסיימת
1. תריץ בדיקת תחביר JS (node --check) על הקוד שערכת
2. תוודא ש-CSS מאוזן (סוגריים פתוחים=סגורים)
3. תוודא שאין ID כפולים
4. אם השינוי משמעותי - תוסיף שורה ל-CHANGELOG.md
