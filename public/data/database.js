/* ==========================================================
   KURSOR — БАЗА ДАННЫХ МОДУЛЕЙ И ЗАДАЧ
   Это единый файл с темами, объяснениями, видео и задачами.
   Структура: МОДУЛИ → ЗАДАЧИ (каждая привязана к module_id).
   Всё можно править через админ-панель или прямо в этом файле.
   ========================================================== */

const MASCOT = {
  happy:    '/uploads/mascot/happy.png',
  sad:      '/uploads/mascot/sad.png',
  explain:  '/uploads/mascot/explain.png',
  sitting:  '/uploads/mascot/sitting.png',
  thinking: '/uploads/mascot/thinking.png',
};
const LOGO = 'https://salamalekum.sirv.com/_1_1.png.webp';

/* ===== ЯЗЫКИ / ТЕХНОЛОГИИ ===== */
const LANGS = {
  scratch:    { name: 'Scratch',           nameKk:'Scratch',                icon:'/uploads/icons/scratch.svg',     class: 'lang-scratch',     group: 1 },
  blockly:    { name: 'Blockly',           nameKk:'Blockly',                icon:'/uploads/icons/blockly.svg',     class: 'lang-blockly',     group: 1 },
  minecraft:  { name: 'Minecraft Edu',     nameKk:'Minecraft Edu',          icon:'/uploads/icons/minecraft.svg',   class: 'lang-minecraft',   group: 1 },
  design:     { name: 'Дизайн/Анимация',   nameKk:'Дизайн/Анимация',        icon:'/uploads/icons/design.svg',      class: 'lang-design',      group: 1 },
  html:       { name: 'HTML / CSS',        nameKk:'HTML / CSS',             icon:'/uploads/icons/html.svg',        class: 'lang-html',        group: 2 },
  python:     { name: 'Python',            nameKk:'Python',                 icon:'/uploads/icons/python.svg',      class: 'lang-python',      group: 2 },
  roblox:     { name: 'Roblox Lua',        nameKk:'Roblox Lua',             icon:'/uploads/icons/roblox.svg',      class: 'lang-roblox',      group: 2 },
  cyber:      { name: 'Кибербезопасность', nameKk:'Киберқауіпсіздік',       icon:'/uploads/icons/cyber.svg',       class: 'lang-cyber',       group: 2 },
  pythonpro:  { name: 'Python Pro',        nameKk:'Python Pro',             icon:'/uploads/icons/python.svg',      class: 'lang-python',      group: 3 },
  java:       { name: 'Java',              nameKk:'Java',                   icon:'/uploads/icons/java.svg',        class: 'lang-java',        group: 3 },
  cpp:        { name: 'C++',               nameKk:'C++',                    icon:'/uploads/icons/cpp.svg',         class: 'lang-cpp',         group: 3 },
  unity:      { name: 'Unity / C#',        nameKk:'Unity / C#',             icon:'/uploads/icons/unity.svg',       class: 'lang-unity',       group: 3 },
  blender:    { name: 'Blender 3D',        nameKk:'Blender 3D',             icon:'/uploads/icons/blender.svg',     class: 'lang-blender',     group: 3 },
  datascience:{ name: 'Data Science',      nameKk:'Data Science',           icon:'/uploads/icons/datascience.svg', class: 'lang-datascience', group: 3 },
};

const GROUPS = {
  1: { name: 'Группа 1 (6–8 лет)',  nameKk:'1-топ (6–8 жас)',  color: '#10b981' },
  2: { name: 'Группа 2 (9–11 лет)', nameKk:'2-топ (9–11 жас)', color: '#3b82f6' },
  3: { name: 'Группа 3 (12–16 лет)', nameKk:'3-топ (12–16 жас)', color: '#a855f7' },
};

/* ===== МОДУЛИ =====
   Каждый модуль = одна тема. Содержит: объяснение, видео, примеры.
   ========================================== */
const MODULES = [
  // ===== SCRATCH =====
  { id:'scratch_1', lang:'scratch', title:'Движение и сцена',
    description:'Учимся двигать кота, менять костюм и держать его на сцене.',
    video:'https://www.youtube.com/embed/ebEzvikobR0',
    explanation:`
<p>Привет! Сегодня мы научимся <b>управлять котом</b> в Scratch!</p>
<p>Scratch — это среда, где код собирается из <b>цветных блоков</b>, как из конструктора Lego. Никаких сложных слов писать не надо!</p>
<h4>Основные блоки движения:</h4>
<ul>
  <li><code>идти 10 шагов</code> — кот двигается вперёд</li>
  <li><code>повернуть на 15 градусов</code> — кот поворачивается</li>
  <li><code>если касается края, оттолкнуться</code> — кот не падает со сцены</li>
  <li><code>следующий костюм</code> — кот меняет позу (как анимация)</li>
</ul>
<h4>Как запустить?</h4>
<p>В Scratch есть зелёный флажок . Поставь сверху блок «Когда нажат зелёный флажок» — и всё что ниже будет работать!</p>
` },

  { id:'scratch_2', lang:'scratch', title:'Условия (если...то)',
    description:'Учим кота реагировать на клавиши и касания.',
    video:'https://www.youtube.com/embed/cMWbyEGH2Fs',
    explanation:`
<p>Условия — это когда программа <b>думает</b> и решает что делать дальше.</p>
<p>Например: <i>"Если идёт дождь — взять зонтик. Иначе — идти так".</i></p>
<h4>Блоки условий в Scratch:</h4>
<ul>
  <li><code>если &lt;...&gt; то</code> — делать что-то ТОЛЬКО если условие верно</li>
  <li><code>если &lt;...&gt; то ... иначе ...</code> — выбор из двух вариантов</li>
  <li><code>клавиша [пробел] нажата?</code> — проверка кнопки</li>
  <li><code>касается края?</code> или <code>касается спрайт2?</code> — проверка касания</li>
</ul>
<p>Совет: условия часто помещают внутрь блока «всегда», чтобы программа постоянно проверяла что происходит.</p>
` },

  { id:'scratch_3', lang:'scratch', title:'Циклы (повторения)',
    description:'Учимся повторять действия без копирования блоков.',
    video:'https://www.youtube.com/embed/NheyBvBaVIw',
    explanation:`
<p>Цикл — это когда мы хотим, чтобы программа <b>повторила</b> что-то несколько раз.</p>
<p>Например: нарисовать квадрат — нужно 4 раза пройти прямо и повернуться на 90°. Без цикла пришлось бы поставить 8 блоков подряд. С циклом — всего 3!</p>
<h4>Виды циклов:</h4>
<ul>
  <li><code>повторить 10 раз</code> — точное количество повторений</li>
  <li><code>всегда</code> — бесконечное повторение (пока не остановим)</li>
  <li><code>повторить пока &lt;...&gt;</code> — пока условие верно</li>
</ul>
<p>Чтобы нарисовать <b>звезду</b> из 5 лучей: повтори 5 раз → идти 100 шагов → повернуть на 144°.</p>
` },

  { id:'scratch_4', lang:'scratch', title:'Переменные и счётчик',
    description:'Создаём счёт очков и таймер.',
    video:'https://www.youtube.com/embed/j8AePyuLw38',
    explanation:`
<p>Переменная — это <b>коробочка</b> с именем, в которую можно положить число или слово.</p>
<p>В играх переменные нужны для: счёта очков, жизней, таймера, здоровья.</p>
<h4>Как создать?</h4>
<ol>
  <li>В разделе «Переменные» нажми <b>Создать переменную</b></li>
  <li>Дай имя: например <code>очки</code></li>
  <li>Используй блоки: <code>задать [очки] = 0</code>, <code>изменить [очки] на 1</code></li>
</ol>
<h4>Пример: счётчик яблок</h4>
<p>Когда кот касается яблока → изменить «очки» на 1. Когда «очки» = 10 → показать «Победа!»</p>
` },

  // ===== BLOCKLY =====
  { id:'blockly_1', lang:'blockly', title:'Алгоритм шагов',
    description:'Учим робота идти по лабиринту шаг за шагом.',
    video:'https://www.youtube.com/embed/Vp3VzVPDc7E',
    explanation:`
<p>Алгоритм — это <b>план действий</b>, чёткая последовательность шагов.</p>
<p>Например, чтобы съесть бутерброд: 1) взять хлеб, 2) намазать масло, 3) положить сыр, 4) откусить.</p>
<p>В Blockly есть робот, и мы пишем для него план:</p>
<ul>
  <li><code>шаг вперёд</code></li>
  <li><code>повернуть налево</code> / <code>направо</code></li>
  <li><code>прыжок</code></li>
</ul>
<p>Главное правило: робот делает только то, что мы сказали. Если забудем повернуть — врежется в стену!</p>
` },

  { id:'blockly_2', lang:'blockly', title:'Циклы в лабиринте',
    description:'Используем повторения вместо одинаковых блоков.',
    video:'https://www.youtube.com/embed/Vp3VzVPDc7E',
    explanation:`
<p>Зачем ставить 5 одинаковых блоков «шаг вперёд», если можно сказать роботу: <b>«повторить шаг 5 раз»</b>?</p>
<p>Это и есть цикл — мы экономим место и делаем программу красивее.</p>
<h4>Блок повторения:</h4>
<pre>повторить 5 раз:
   шаг вперёд</pre>
<p>Также есть умный цикл <b>«повторять пока не дойдёшь до финиша»</b> — робот сам остановится в нужном месте.</p>
` },

  { id:'blockly_3', lang:'blockly', title:'Условия для робота',
    description:'Робот сам решает: повернуть или собрать монету.',
    video:'https://www.youtube.com/embed/Vp3VzVPDc7E',
    explanation:`
<p>Условие помогает роботу <b>принимать решение</b>.</p>
<ul>
  <li><code>если впереди стена → повернуть направо</code></li>
  <li><code>если на клетке монета → собрать</code></li>
  <li><code>если можно идти вперёд → шаг</code></li>
</ul>
<p>Условия + циклы = очень умные программы. Можно проходить любые лабиринты всего одним коротким кодом!</p>
` },

  // ===== MINECRAFT =====
  { id:'minecraft_1', lang:'minecraft', title:'Координаты и постройки',
    description:'Что такое X, Y, Z и как найти блок в мире.',
    video:'https://www.youtube.com/embed/2QXm9rDqXm0',
    explanation:`
<p>В Minecraft мир — это <b>3D-пространство</b>. У каждого блока есть свой адрес — координаты:</p>
<ul>
  <li><b>X</b> — куда идём (восток ↔ запад)</li>
  <li><b>Y</b> — высота (вверх ↕ вниз)</li>
  <li><b>Z</b> — глубина (север ↔ юг)</li>
</ul>
<p>Нажми <kbd>F3</kbd> (или <kbd>Fn+F3</kbd>) — увидишь свои координаты.</p>
<p>Команда <code>/tp @s 100 70 50</code> телепортирует тебя в точку X=100, Y=70, Z=50.</p>
` },

  { id:'minecraft_2', lang:'minecraft', title:'Агент и команды',
    description:'Программируем агента строить дом и сажать деревья.',
    video:'https://www.youtube.com/embed/rYK_rjSQry4',
    explanation:`
<p><b>Агент</b> — это твой помощник-робот в Minecraft Education. Ему можно давать команды в коде!</p>
<h4>Основные команды агента (на блоках или Python):</h4>
<ul>
  <li><code>agent.move("forward", 5)</code> — пройти 5 шагов вперёд</li>
  <li><code>agent.turn("left")</code> — повернуть налево</li>
  <li><code>agent.place("forward")</code> — положить блок</li>
  <li><code>agent.till("down")</code> — вспахать землю</li>
</ul>
<p>Чтобы построить стену 5 блоков — используй цикл: повторить 5 раз → положить блок → шаг вперёд.</p>
` },

  // ===== DESIGN =====
  { id:'design_1', lang:'design', title:'Пиксель-арт',
    description:'Рисуем персонажа из квадратиков 16×16.',
    video:'https://www.youtube.com/embed/Iage6QLg-zM',
    explanation:`
<p>Пиксель-арт — это рисунки из <b>квадратиков</b> (пикселей). Так выглядят старые игры на Денди!</p>
<p>Размер 16×16 — это очень популярный формат: помещается персонаж, но не слишком сложно.</p>
<h4>Правила хорошего пиксель-арта:</h4>
<ol>
  <li>Используй мало цветов (4–6 достаточно)</li>
  <li>Сначала рисуй контур, потом заливай</li>
  <li>Добавляй тени — будет объёмно</li>
  <li>Глаза делай крупными — персонаж станет милее</li>
</ol>
` },

  { id:'design_2', lang:'design', title:'Анимация кадрами',
    description:'Делаем GIF из нескольких рисунков.',
    video:'https://www.youtube.com/embed/VM7DRlzVnK0',
    explanation:`
<p>Анимация — это <b>много картинок</b> подряд, которые быстро меняются. Так появляется движение!</p>
<p>Один кадр = одна картинка. В мультфильме 24 кадра в секунду.</p>
<h4>Простая анимация ходьбы:</h4>
<ul>
  <li>Кадр 1: ноги вместе</li>
  <li>Кадр 2: правая нога вперёд</li>
  <li>Кадр 3: ноги вместе</li>
  <li>Кадр 4: левая нога вперёд</li>
</ul>
<p>4 кадра = плавная ходьба. Меньше — будет дёрганно.</p>
` },

  // ===== HTML/CSS =====
  { id:'html_1', lang:'html', title:'Теги и структура',
    description:'Базовые теги HTML: заголовки, абзацы, списки, ссылки.',
    video:'https://www.youtube.com/embed/1OL38vcF-VM',
    explanation:`
<p>HTML — это <b>язык разметки</b>. С его помощью мы говорим браузеру: «здесь заголовок, здесь картинка, здесь ссылка».</p>
<h4>Основные теги:</h4>
<pre>&lt;h1&gt;Большой заголовок&lt;/h1&gt;
&lt;p&gt;Это обычный абзац текста.&lt;/p&gt;
&lt;ul&gt;
  &lt;li&gt;Молоко&lt;/li&gt;
  &lt;li&gt;Хлеб&lt;/li&gt;
&lt;/ul&gt;
&lt;a href="https://google.com"&gt;Гугл&lt;/a&gt;
&lt;strong&gt;Жирный текст&lt;/strong&gt;</pre>
<p><b>Важно:</b> каждый тег нужно <u>закрывать</u>! Открыли <code>&lt;p&gt;</code> — обязательно поставьте <code>&lt;/p&gt;</code>.</p>
` },

  { id:'html_2', lang:'html', title:'Картинки и таблицы',
    description:'Вставка изображений и создание таблиц.',
    video:'https://www.youtube.com/embed/NP2NJVfgWm8',
    explanation:`
<p>Чтобы вставить картинку: <code>&lt;img src="cat.jpg" alt="Котик"&gt;</code></p>
<ul>
  <li><b>src</b> — путь к файлу или ссылка из интернета</li>
  <li><b>alt</b> — описание (если картинка не загрузится)</li>
</ul>
<h4>Таблица:</h4>
<pre>&lt;table&gt;
  &lt;tr&gt;&lt;th&gt;Урок&lt;/th&gt;&lt;th&gt;Время&lt;/th&gt;&lt;/tr&gt;
  &lt;tr&gt;&lt;td&gt;Математика&lt;/td&gt;&lt;td&gt;9:00&lt;/td&gt;&lt;/tr&gt;
&lt;/table&gt;</pre>
<p><code>&lt;tr&gt;</code> = строка, <code>&lt;td&gt;</code> = ячейка, <code>&lt;th&gt;</code> = заголовочная ячейка.</p>
` },

  { id:'html_3', lang:'html', title:'CSS стили',
    description:'Меняем цвета, шрифты и размеры.',
    video:'https://www.youtube.com/embed/AXNbtVTYVSM',
    explanation:`
<p>CSS = <b>красота</b> HTML. С помощью CSS делаем сайт цветным и красивым.</p>
<h4>Базовый синтаксис:</h4>
<pre>селектор {
  свойство: значение;
}

p {
  color: red;
  font-size: 18px;
  background: yellow;
}</pre>
<h4>Самые нужные свойства:</h4>
<ul>
  <li><code>color</code> — цвет текста</li>
  <li><code>background</code> — фон</li>
  <li><code>font-size</code> — размер шрифта</li>
  <li><code>border</code> — рамка (например: <code>2px solid blue</code>)</li>
  <li><code>padding</code> — отступ внутри</li>
  <li><code>margin</code> — отступ снаружи</li>
</ul>
` },

  { id:'html_4', lang:'html', title:'Flexbox и сетки',
    description:'Делаем элементы в ряд и в сетку.',
    video:'https://www.youtube.com/embed/NddTNohooIs',
    explanation:`
<p>Flexbox — это супер-инструмент CSS, чтобы располагать элементы в ряд или в столбик.</p>
<pre>.container {
  display: flex;
  gap: 20px;
  justify-content: center;
}</pre>
<ul>
  <li><code>display: flex</code> — включить flex-режим</li>
  <li><code>gap</code> — расстояние между элементами</li>
  <li><code>justify-content</code> — выравнивание по горизонтали (center, space-between)</li>
  <li><code>align-items</code> — по вертикали (center)</li>
  <li><code>flex-direction: column</code> — поставить в столбик</li>
</ul>
` },

  // ===== PYTHON =====
  { id:'python_1', lang:'python', title:'print и переменные',
    description:'Первый код на Python: вывод и хранение данных.',
    video:'https://www.youtube.com/embed/kZUia3DYbBc',
    explanation:`
<p>Python — это самый <b>понятный язык программирования</b>. Код выглядит как обычный английский!</p>
<h4>Вывод на экран:</h4>
<pre>print("Привет, мир!")
print("Меня зовут Аян")</pre>
<h4>Переменные — коробочки для данных:</h4>
<pre>name = "Аян"
age = 10
print("Меня зовут", name, "мне", age, "лет")</pre>
<h4>Математика:</h4>
<pre>a = 5
b = 3
print(a + b)   # 8
print(a * b)   # 15
print(a - b)   # 2
print(a / b)   # 1.666...</pre>
` },

  { id:'python_2', lang:'python', title:'Условия if/else',
    description:'Программа сама принимает решения.',
    video:'https://www.youtube.com/embed/Z65QttzP36U',
    explanation:`
<p>Условия позволяют программе <b>выбирать</b> что делать.</p>
<pre>age = 12
if age >= 7:
    print("Можно идти в школу")
else:
    print("Ещё рано")</pre>
<h4>Операторы сравнения:</h4>
<ul>
  <li><code>==</code> равно (внимание: 2 знака!)</li>
  <li><code>!=</code> не равно</li>
  <li><code>&gt;</code> больше, <code>&lt;</code> меньше</li>
  <li><code>&gt;=</code> больше или равно, <code>&lt;=</code> меньше или равно</li>
</ul>
<p><b>Важно:</b> в Python отступы (пробелы в начале строки) — это часть кода! Они показывают, что строка внутри <code>if</code>.</p>
` },

  { id:'python_3', lang:'python', title:'Циклы for и while',
    description:'Повторяем код много раз.',
    video:'https://www.youtube.com/embed/LFCq-mNF96c',
    explanation:`
<p>Цикл — чтобы не писать одно и то же 100 раз.</p>
<h4>for — точное количество раз:</h4>
<pre>for i in range(5):
    print("Привет!", i)</pre>
<p>Выведет: <code>Привет! 0, Привет! 1, ... Привет! 4</code></p>
<h4>while — пока условие верно:</h4>
<pre>n = 10
while n > 0:
    print(n)
    n = n - 1
print("Старт!")</pre>
<p>Это обратный отсчёт от 10 до 1.</p>
` },

  { id:'python_4', lang:'python', title:'Строки и работа с текстом',
    description:'Длина, поиск букв, переворот слов.',
    video:'https://www.youtube.com/embed/lDopbLZeMTg',
    explanation:`
<p>Строка — это любой текст в кавычках: <code>"привет"</code>.</p>
<h4>Полезные операции:</h4>
<pre>s = "программирование"
print(len(s))         # 16 — длина
print(s.upper())      # ПРОГРАММИРОВАНИЕ
print(s[0])           # п — первая буква
print(s[-1])          # е — последняя
print(s[::-1])        # переворот: еинавориммаргорп
print(s.count("р"))   # 3 — сколько раз "р"
print("грамм" in s)   # True — содержится ли</pre>
<p>Палиндром — это слово, которое читается одинаково в обе стороны (мадам, шалаш).</p>
` },

  // ===== ROBLOX =====
  { id:'roblox_1', lang:'roblox', title:'Интерфейс Roblox Studio',
    description:'Знакомство с панелями редактора.',
    video:'https://www.youtube.com/embed/UFYxQwgWO_0',
    explanation:`
<p>Roblox Studio — программа, в которой мы создаём свои игры.</p>
<h4>Главные панели:</h4>
<ul>
  <li><b>Explorer</b> — список всех объектов в мире (как файлы в папках)</li>
  <li><b>Properties</b> — свойства выбранного объекта (цвет, размер, позиция)</li>
  <li><b>Toolbox</b> — готовые модели и звуки (можно вставить в свой мир)</li>
  <li><b>Output</b> — окно с ошибками и сообщениями скриптов</li>
</ul>
<p>Любой объект в Roblox = <b>Part</b> (кирпич). У него есть цвет, материал, размер и позиция.</p>
` },

  { id:'roblox_2', lang:'roblox', title:'Скрипты на Lua',
    description:'Первые скрипты: свечение, очки за монеты.',
    video:'https://www.youtube.com/embed/UFYxQwgWO_0',
    explanation:`
<p>Lua — язык скриптов в Roblox. Чтобы добавить скрипт: правой кнопкой по Part → Insert Object → Script.</p>
<h4>Светящийся кирпич при касании:</h4>
<pre>local part = script.Parent

part.Touched:Connect(function(hit)
    part.Material = Enum.Material.Neon
    part.BrickColor = BrickColor.new("Bright yellow")
end)</pre>
<p><code>script.Parent</code> = объект, в котором лежит скрипт. <code>Touched</code> — событие касания.</p>
` },

  // ===== CYBER =====
  { id:'cyber_1', lang:'cyber', title:'Надёжные пароли',
    description:'Учимся придумывать пароли, которые не взломают.',
    video:'https://www.youtube.com/embed/Y0UWs4vq7Vo',
    explanation:`
<p>Пароль — это ключ к твоему аккаунту. Если он плохой — взломщик войдёт за секунды!</p>
<h4>Правила надёжного пароля:</h4>
<ol>
  <li>Минимум 12 символов</li>
  <li>Большие И маленькие буквы</li>
  <li>Цифры</li>
  <li>Спец-символы: !@#$%^&*</li>
  <li>НЕ дата рождения, НЕ имя, НЕ "123456"</li>
</ol>
<p>Хороший: <code>Koshka_2025!Igraet</code></p>
<p>Плохой: <code>qwerty</code>, <code>password</code>, <code>123456</code></p>
<p>Совет: используй <b>менеджер паролей</b> (Bitwarden, 1Password) — он запомнит всё за тебя.</p>
` },

  { id:'cyber_2', lang:'cyber', title:'Фишинг — как не попасться',
    description:'Распознаём опасные письма и сайты.',
    video:'https://www.youtube.com/embed/TF56PlW7Lh4',
    explanation:`
<p>Фишинг — это когда мошенник делает <b>фальшивый сайт</b> или письмо, чтобы украсть твой пароль.</p>
<h4>Признаки фишингового письма:</h4>
<ul>
  <li>Подозрительный отправитель (например <code>support@gmai1.com</code> вместо <code>gmail.com</code>)</li>
  <li>Срочные угрозы: «Ваш аккаунт заблокируют через 24 часа!»</li>
  <li>Странные ссылки (наведи мышку — посмотри куда ведёт)</li>
  <li>Подозрительные файлы (.exe, .zip от незнакомцев)</li>
  <li>Ошибки в тексте и плохой перевод</li>
</ul>
<p>Если сомневаешься — НЕ нажимай. Лучше открой сайт напрямую через адресную строку.</p>
` },

  { id:'cyber_3', lang:'cyber', title:'Как работают вирусы',
    description:'Откуда берутся вирусы и как защититься.',
    video:'https://www.youtube.com/embed/6avzN1QglK4',
    explanation:`
<p>Вирус — это <b>вредная программа</b>, которая может удалить файлы, украсть пароли или замедлить компьютер.</p>
<h4>Как вирус попадает на ПК:</h4>
<ol>
  <li>Скачивание пиратских игр и программ</li>
  <li>Открытие вложений из неизвестных писем</li>
  <li>Подключение чужой флешки</li>
  <li>Клик по рекламе вроде "Поздравляем, вы выиграли iPhone!"</li>
</ol>
<h4>Защита:</h4>
<ul>
  <li>Антивирус (Windows Defender, Kaspersky)</li>
  <li>Регулярные обновления Windows</li>
  <li>Не скачивай что попало</li>
  <li>Делай резервные копии важных файлов</li>
</ul>
` },

  // ===== PYTHON PRO =====
  { id:'pythonpro_1', lang:'pythonpro', title:'Списки и словари',
    description:'Хранение коллекций данных.',
    video:'https://www.youtube.com/embed/Ir3LpiCcMrI',
    explanation:`
<p><b>Список</b> — упорядоченная коллекция элементов в квадратных скобках:</p>
<pre>grades = [5, 4, 5, 3, 5, 4]
print(grades[0])        # 5 (первый)
print(len(grades))      # 6
grades.append(5)        # добавить в конец
grades.sort()           # отсортировать
print(max(grades))      # лучшая оценка</pre>
<p><b>Словарь</b> — пары "ключ: значение":</p>
<pre>student = {"name": "Алия", "age": 13, "grade": 5}
print(student["name"])  # Алия
student["school"] = "КУРСОР"
for key, value in student.items():
    print(key, "=", value)</pre>
` },

  { id:'pythonpro_2', lang:'pythonpro', title:'Функции',
    description:'Свои собственные команды.',
    video:'https://www.youtube.com/embed/cKRRysbQZsM',
    explanation:`
<p>Функция = <b>именованный кусок кода</b>, который можно использовать много раз.</p>
<pre>def greet(name):
    print("Привет,", name, "!")

greet("Алия")
greet("Аян")
greet("Айгерим")</pre>
<h4>Возврат значения:</h4>
<pre>def square(x):
    return x * x

result = square(5)   # 25
print(square(10))    # 100</pre>
<p>Хорошие функции делают <b>одну</b> вещь и имеют понятное имя.</p>
` },

  { id:'pythonpro_3', lang:'pythonpro', title:'Файлы и CSV',
    description:'Читаем и пишем данные на диск.',
    video:'https://www.youtube.com/embed/iX28sWsAT4Y',
    explanation:`
<p>Программа может <b>сохранять</b> данные в файл и <b>читать</b> их обратно.</p>
<pre># Запись
with open("notes.txt", "w") as f:
    f.write("Привет!\\n")
    f.write("Это вторая строка")

# Чтение
with open("notes.txt", "r") as f:
    content = f.read()
    print(content)</pre>
<h4>CSV (таблица):</h4>
<pre>import csv
with open("contacts.csv") as f:
    reader = csv.reader(f)
    for row in reader:
        print(row[0], row[1])</pre>
` },

  { id:'pythonpro_4', lang:'pythonpro', title:'ООП — Классы',
    description:'Создаём свои типы данных.',
    video:'https://www.youtube.com/embed/v1SkadIiP2k',
    explanation:`
<p>ООП (объектно-ориентированное программирование) — мощный способ организовать код.</p>
<p><b>Класс</b> — это чертёж. <b>Объект</b> — реальная вещь по этому чертежу.</p>
<pre>class Student:
    def __init__(self, name, grade):
        self.name = name
        self.grade = grade

    def info(self):
        print(f"{self.name}, оценка: {self.grade}")

s1 = Student("Алия", 5)
s2 = Student("Аян", 4)
s1.info()
s2.info()</pre>
<p><code>__init__</code> — конструктор, вызывается при создании объекта. <code>self</code> — ссылка на сам объект.</p>
` },

  { id:'pythonpro_5', lang:'pythonpro', title:'Алгоритмы сортировки и поиска',
    description:'Сортировка пузырьком и бинарный поиск.',
    video:'https://www.youtube.com/embed/dd3RcafdOQk',
    explanation:`
<p><b>Сортировка пузырьком:</b> сравниваем соседей и меняем местами, пока всё не упорядочится.</p>
<pre>def bubble_sort(arr):
    n = len(arr)
    for i in range(n):
        for j in range(n - i - 1):
            if arr[j] > arr[j+1]:
                arr[j], arr[j+1] = arr[j+1], arr[j]
    return arr</pre>
<p><b>Бинарный поиск:</b> ищем число в отсортированном списке, каждый раз делим пополам.</p>
<pre>def binary_search(arr, target):
    lo, hi = 0, len(arr) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target: return mid
        elif arr[mid] < target: lo = mid + 1
        else: hi = mid - 1
    return -1</pre>
` },

  // ===== JAVA =====
  { id:'java_1', lang:'java', title:'Синтаксис и Scanner',
    description:'Первая программа на Java, ввод данных.',
    video:'https://www.youtube.com/embed/jNaJzmChPvY',
    explanation:`
<p>Java — серьёзный язык, на котором написаны Minecraft и Android-приложения.</p>
<pre>import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.print("Как тебя зовут? ");
        String name = sc.nextLine();
        System.out.println("Привет, " + name + "!");
    }
}</pre>
<p>В Java каждая строка кода заканчивается <b>точкой с запятой</b> <code>;</code>. Это самая частая ошибка!</p>
` },

  { id:'java_2', lang:'java', title:'ООП в Java',
    description:'Класс Студент с полями и методами.',
    video:'https://www.youtube.com/embed/v1SkadIiP2k',
    explanation:`
<pre>public class Student {
    String name;
    int grade;

    Student(String n, int g) {
        name = n;
        grade = g;
    }

    void getInfo() {
        System.out.println(name + ": " + grade);
    }

    boolean isExcellent() {
        return grade == 5;
    }
}

// Использование:
Student a = new Student("Алия", 5);
a.getInfo();
System.out.println(a.isExcellent());</pre>
` },

  { id:'java_3', lang:'java', title:'ArrayList',
    description:'Динамические массивы в Java.',
    video:'https://www.youtube.com/embed/ArERhPCnpIM',
    explanation:`
<pre>import java.util.ArrayList;

ArrayList&lt;String&gt; todo = new ArrayList&lt;&gt;();
todo.add("Сделать домашку");
todo.add("Покормить кота");
todo.add("Погулять");

for (String task : todo) {
    System.out.println("- " + task);
}

todo.remove(0);          // удалить первую
System.out.println(todo.size());</pre>
` },

  { id:'java_4', lang:'java', title:'Наследование',
    description:'Shape → Circle, Rectangle.',
    video:'https://www.youtube.com/embed/SC_goCYNkC4',
    explanation:`
<pre>class Shape {
    double area() { return 0; }
}

class Circle extends Shape {
    double r;
    Circle(double r) { this.r = r; }
    double area() { return Math.PI * r * r; }
}

class Rectangle extends Shape {
    double w, h;
    Rectangle(double w, double h) { this.w = w; this.h = h; }
    double area() { return w * h; }
}</pre>
<p><code>extends</code> = «наследует». Circle получает всё от Shape, но переопределяет <code>area()</code>.</p>
` },

  // ===== C++ =====
  { id:'cpp_1', lang:'cpp', title:'Ввод/вывод и переменные',
    description:'cin, cout, типы данных.',
    video:'https://www.youtube.com/embed/QN1UsaL3u5A',
    explanation:`
<pre>#include &lt;iostream&gt;
using namespace std;

int main() {
    int a, b;
    cout << "Введи два числа: ";
    cin >> a >> b;
    cout << "Сумма: " << a + b << endl;
    return 0;
}</pre>
<h4>Типы:</h4>
<ul>
  <li><code>int</code> — целое число</li>
  <li><code>float</code>/<code>double</code> — дробное</li>
  <li><code>string</code> — строка (нужно <code>#include &lt;string&gt;</code>)</li>
  <li><code>char</code> — один символ</li>
  <li><code>bool</code> — true/false</li>
</ul>
` },

  { id:'cpp_2', lang:'cpp', title:'Условия и циклы C++',
    description:'if, for, while.',
    video:'https://www.youtube.com/embed/YkL7yN23It8',
    explanation:`
<pre>int n;
cin >> n;

// Простое ли число?
bool prime = true;
if (n < 2) prime = false;
for (int i = 2; i * i <= n; i++) {
    if (n % i == 0) { prime = false; break; }
}
cout << (prime ? "Простое" : "Составное");</pre>
<p>Числа Фибоначчи:</p>
<pre>int a = 0, b = 1;
while (a < 100) {
    cout << a << " ";
    int c = a + b;
    a = b; b = c;
}</pre>
` },

  { id:'cpp_3', lang:'cpp', title:'Массивы и vector',
    description:'Работа с коллекциями данных.',
    video:'https://www.youtube.com/embed/44y44mniCJ4',
    explanation:`
<pre>#include &lt;vector&gt;
#include &lt;algorithm&gt;

vector&lt;int&gt; arr = {5, 2, 8, 1, 9, 3};
sort(arr.begin(), arr.end());           // сортировка
int mx = *max_element(arr.begin(), arr.end());
int mn = *min_element(arr.begin(), arr.end());

int sum = 0;
for (int x : arr) sum += x;
double avg = (double)sum / arr.size();</pre>
` },

  { id:'cpp_4', lang:'cpp', title:'Функции и рекурсия',
    description:'Факториал, НОД, степень.',
    video:'https://www.youtube.com/embed/_WGNSVDb0t8',
    explanation:`
<p>Рекурсия — функция вызывает <b>сама себя</b>.</p>
<pre>// Факториал
int fact(int n) {
    if (n <= 1) return 1;
    return n * fact(n - 1);
}

// НОД (алгоритм Евклида)
int gcd(int a, int b) {
    if (b == 0) return a;
    return gcd(b, a % b);
}

// Степень
int power(int base, int exp) {
    if (exp == 0) return 1;
    return base * power(base, exp - 1);
}</pre>
` },

  // ===== UNITY =====
  { id:'unity_1', lang:'unity', title:'GameObject и компоненты',
    description:'Из чего состоит объект в Unity.',
    video:'https://www.youtube.com/embed/pl_w6sKEbPY',
    explanation:`
<p>В Unity <b>всё — это GameObject</b>. На него навешиваются компоненты:</p>
<ul>
  <li><b>Transform</b> — позиция, поворот, масштаб (есть всегда)</li>
  <li><b>Rigidbody</b> — физика (гравитация, столкновения)</li>
  <li><b>Collider</b> — невидимая граница для столкновений</li>
  <li><b>MeshRenderer</b> — что мы видим (форма)</li>
  <li><b>Script</b> — наш код на C#</li>
</ul>
<p>Если объект «проваливается сквозь пол» — забыл добавить Collider!</p>
` },

  { id:'unity_2', lang:'unity', title:'Скрипты C# в Unity',
    description:'Двигаем объект клавишами.',
    video:'https://www.youtube.com/embed/NI3sCw7Upaw',
    explanation:`
<pre>using UnityEngine;

public class PlayerMove : MonoBehaviour {
    public float speed = 5f;

    void Update() {
        float x = Input.GetAxis("Horizontal");
        float z = Input.GetAxis("Vertical");
        transform.Translate(new Vector3(x, 0, z) * speed * Time.deltaTime);
    }
}</pre>
<p><code>Update()</code> вызывается <b>каждый кадр</b> (~60 раз в секунду).</p>
<p><code>Time.deltaTime</code> — время между кадрами, чтобы движение было плавным на любом ПК.</p>
` },

  { id:'unity_3', lang:'unity', title:'Физика и столкновения',
    description:'Прыжок и триггеры.',
    video:'https://www.youtube.com/embed/AMPZ5zVjxyo',
    explanation:`
<pre>// Прыжок при нажатии пробела
void Update() {
    if (Input.GetKeyDown(KeyCode.Space)) {
        GetComponent&lt;Rigidbody&gt;().AddForce(Vector3.up * 500);
    }
}

// Собираем монету
void OnTriggerEnter(Collider other) {
    if (other.tag == "Coin") {
        Destroy(other.gameObject);
        score += 1;
    }
}</pre>
` },

  // ===== BLENDER =====
  { id:'blender_1', lang:'blender', title:'Интерфейс Blender',
    description:'Окна, режимы, горячие клавиши.',
    video:'https://www.youtube.com/embed/5KY7PXalXKU',
    explanation:`
<p>Blender — бесплатный редактор для 3D моделей, анимации и даже игр.</p>
<h4>Режимы работы:</h4>
<ul>
  <li><b>Object Mode</b> — перемещение объектов</li>
  <li><b>Edit Mode</b> — редактирование вершин/рёбер/граней</li>
  <li><b>Sculpt Mode</b> — лепка как из глины</li>
  <li><b>Vertex Paint</b> — раскраска точек</li>
  <li><b>Texture Paint</b> — рисование на 3D объекте</li>
</ul>
<h4>Главные горячие клавиши:</h4>
<ul>
  <li><kbd>G</kbd> — Grab (двигать)</li>
  <li><kbd>R</kbd> — Rotate (вращать)</li>
  <li><kbd>S</kbd> — Scale (масштаб)</li>
  <li><kbd>Tab</kbd> — переключение Edit/Object Mode</li>
  <li><kbd>Shift+A</kbd> — добавить объект</li>
</ul>
` },

  { id:'blender_2', lang:'blender', title:'Моделинг — стул из куба',
    description:'Создаём первую модель.',
    video:'https://www.youtube.com/embed/u_pj9RP1ByM',
    explanation:`
<p>Любая 3D модель начинается с простой формы. Стул можно сделать из 5 кубов!</p>
<h4>План:</h4>
<ol>
  <li>Добавь куб (Shift+A → Mesh → Cube)</li>
  <li>Расплющи его — это будет сиденье</li>
  <li>Дублируй (Shift+D) 4 раза — это ножки, удлини их</li>
  <li>Добавь ещё один куб — спинку</li>
  <li>Расположи всё правильно</li>
  <li>Покрась через Material Properties</li>
</ol>
<p>Используй <kbd>Numpad 1/3/7</kbd> для видов спереди/сбоку/сверху.</p>
` },

  { id:'blender_3', lang:'blender', title:'Анимация по ключевым кадрам',
    description:'Заставляем персонажа двигаться.',
    video:'https://www.youtube.com/embed/U1C98Ywt7Fo',
    explanation:`
<p><b>Ключевой кадр</b> (keyframe) — это «снимок» положения объекта в определённый момент.</p>
<h4>Простая анимация:</h4>
<ol>
  <li>Выбери объект, кадр 1 → нажми <kbd>I</kbd> → Location</li>
  <li>Перейди на кадр 30, передвинь объект → снова <kbd>I</kbd> → Location</li>
  <li>Нажми Play — объект сам поедет!</li>
</ol>
<p>Blender автоматически рассчитает все промежуточные кадры — это называется <b>интерполяция</b>.</p>
` },

  // ===== DATA SCIENCE =====
  { id:'ds_1', lang:'datascience', title:'pandas — работа с данными',
    description:'Загружаем CSV, считаем статистику.',
    video:'https://www.youtube.com/embed/iX28sWsAT4Y',
    explanation:`
<pre>import pandas as pd

# Загружаем данные
df = pd.read_csv("grades.csv")
print(df.head())              # первые 5 строк
print(df.describe())          # статистика по числам
print(df["math"].mean())      # среднее по математике
print(df["math"].median())    # медиана
best = df.loc[df["math"].idxmax()]
print("Лучший:", best["name"])</pre>
<p>pandas — главная библиотека для анализа данных. Работает с таблицами (DataFrame) как Excel, но мощнее.</p>
` },

  { id:'ds_2', lang:'datascience', title:'matplotlib — графики',
    description:'Рисуем столбчатые и линейные графики.',
    video:'https://www.youtube.com/embed/dd3RcafdOQk',
    explanation:`
<pre>import matplotlib.pyplot as plt

names = ["Алия", "Аян", "Айгерим", "Бекзат"]
scores = [95, 87, 92, 78]

plt.bar(names, scores, color="skyblue")
plt.title("Оценки за контрольную")
plt.ylabel("Баллы")
plt.show()</pre>
<p>Для линейного графика просто замени <code>plt.bar</code> на <code>plt.plot</code>.</p>
<p>Хороший график = понятный заголовок, подписанные оси, легенда.</p>
` },

  { id:'ds_3', lang:'datascience', title:'Олимпиадные задачи',
    description:'Логика, скорость, разбор.',
    video:'https://www.youtube.com/embed/Ir3LpiCcMrI',
    explanation:`
<p>Олимпиадные задачи учат <b>думать</b>. Здесь важен не код, а идея решения!</p>
<h4>Часто встречающиеся техники:</h4>
<ul>
  <li><b>Жадные алгоритмы</b> — на каждом шаге берём лучшее</li>
  <li><b>Динамическое программирование</b> — сохраняем уже решённые подзадачи</li>
  <li><b>Поиск в ширину/глубину</b> — для лабиринтов и графов</li>
  <li><b>Префиксные суммы</b> — быстрый подсчёт суммы интервала</li>
</ul>
<p>Сначала <b>проанализируй пример руками</b> на бумаге. Потом превращай в код.</p>
` },
];

/* ===== ЗАДАЧИ =====
   Типы:
   - quiz       : выбор из 4 вариантов (options + answer = индекс)
   - fill       : заполни пропуск (answer — строка для точного совпадения, lowercase)
   - order      : расставь строки (items — правильный порядок)
   - code       : напиши код (expectedOutput — что должно вывести)
   - project    : мини-проект (ручная проверка — submission поле)
*/

const TASKS = [
  // ========== SCRATCH ==========
  { id:1, module:'scratch_1', type:'quiz', title:'Какой блок двигает кота?', difficulty:1,
    description:'Выбери блок, который заставит кота пройти 10 шагов вперёд.',
    options:['идти 10 шагов','повернуть 10°','сказать "10"','подождать 10 сек'], answer:0,
    explain:'Блок "идти X шагов" двигает спрайт по сцене.' },

  { id:2, module:'scratch_1', type:'quiz', title:'Что делает «следующий костюм»?', difficulty:1,
    description:'Зачем используют блок "следующий костюм"?',
    options:['Меняет фон сцены','Анимирует спрайт сменой картинок','Останавливает программу','Удаляет спрайт'], answer:1,
    explain:'Сменяя костюмы спрайта быстро, мы получаем анимацию (как в мультике).' },

  { id:3, module:'scratch_1', type:'fill', title:'Заполни пропуск', difficulty:1,
    description:'Чтобы кот не упал со сцены, используем блок: «если касается ___, оттолкнуться». Что вставить?',
    answer:'края', explain:'Точное название блока: «если касается края, оттолкнуться».' },

  { id:4, module:'scratch_2', type:'quiz', title:'Какой блок проверяет нажатие клавиши?', difficulty:1,
    description:'Чтобы узнать, нажата ли стрелка вверх:',
    options:['клавиша [вверх] нажата?','когда клавиша [вверх] нажата','задать [вверх] значение','спросить [вверх]'], answer:0,
    explain:'«Клавиша X нажата?» — это блок-условие. Возвращает true/false.' },

  { id:5, module:'scratch_2', type:'quiz', title:'Если...иначе', difficulty:2,
    description:'Если игрок касается врага → потерять жизнь. Иначе → продолжать движение. Какой блок нужен?',
    options:['повторить','если...то...иначе','задать переменную','послать сообщение'], answer:1,
    explain:'Блок «если...то...иначе» позволяет выбирать одно из двух действий.' },

  { id:6, module:'scratch_3', type:'fill', title:'Сколько повторений для квадрата?', difficulty:1,
    description:'Чтобы нарисовать квадрат, нужно: повторить ___ раз → идти 100 шагов → повернуть на 90°. Сколько раз повторить?',
    answer:'4', explain:'У квадрата 4 стороны и 4 угла — поэтому 4 повторения.' },

  { id:7, module:'scratch_3', type:'fill', title:'Угол поворота для звезды', difficulty:2,
    description:'Чтобы нарисовать звезду из 5 лучей: повторить 5 → идти 100 → повернуть на ___°. Какой угол?',
    answer:'144', explain:'Для звезды с 5 лучами используется угол 144°. Формула: 360°×2/5 = 144°.' },

  { id:8, module:'scratch_3', type:'quiz', title:'Что значит «всегда»?', difficulty:1,
    description:'Блок «всегда» в Scratch:',
    options:['Выполнить один раз','Повторять бесконечно','Подождать 1 секунду','Остановить программу'], answer:1,
    explain:'«Всегда» — это бесконечный цикл, отлично для постоянных проверок (например, движения).' },

  { id:9, module:'scratch_4', type:'quiz', title:'Зачем нужны переменные?', difficulty:1,
    description:'Главная задача переменной в игре:',
    options:['Хранить число (например, очки)','Двигать персонажа','Менять фон','Рисовать линии'], answer:0,
    explain:'Переменная — это коробочка для данных. В играх часто хранят очки, жизни, время.' },

  { id:10, module:'scratch_4', type:'project', title:'Проект: Поймай яблоко ', difficulty:3,
    description:'Создай в Scratch игру: персонаж ловит яблоки, падающие сверху. Считай очки. При 10 очках — победа! Загрузи скриншот или ссылку на проект.',
    explain:'Это твой первый полноценный проект! Используй переменную "очки", цикл "всегда", условие касания.' },

  // ========== BLOCKLY ==========
  { id:11, module:'blockly_1', type:'order', title:'Дойти до флажка', difficulty:1,
    description:'Расставь команды в правильном порядке. Робот должен пройти 3 шага вперёд, повернуть налево, ещё 2 шага.',
    items:['шаг вперёд','шаг вперёд','шаг вперёд','повернуть налево','шаг вперёд','шаг вперёд'],
    explain:'Порядок важен! Если повернёшь раньше — пойдёшь не туда.' },

  { id:12, module:'blockly_1', type:'quiz', title:'Что такое алгоритм?', difficulty:1,
    description:'Алгоритм — это...',
    options:['Случайные команды','Чёткая последовательность шагов для решения задачи','Название блока','Цвет робота'], answer:1,
    explain:'Алгоритм = понятный план действий. По нему можно повторить решение.' },

  { id:13, module:'blockly_2', type:'fill', title:'Замени повторами', difficulty:2,
    description:'Вместо 5 блоков "шаг вперёд" — используем "повторить ___ раз". Какое число?',
    answer:'5', explain:'5 одинаковых шагов = повторить 5 раз. Программа стала короче!' },

  { id:14, module:'blockly_3', type:'quiz', title:'Условие для лабиринта', difficulty:2,
    description:'Робот идёт по лабиринту. Когда нужно использовать "если впереди стена — повернуть"?',
    options:['Никогда','Только в начале','Внутри цикла "всегда"','После финиша'], answer:2,
    explain:'Внутри цикла «всегда» робот постоянно проверяет: есть ли стена впереди?' },

  // ========== MINECRAFT ==========
  { id:15, module:'minecraft_1', type:'quiz', title:'Координаты в Minecraft', difficulty:1,
    description:'Что обозначает координата Y?',
    options:['Восток-запад','Высоту (верх-низ)','Север-юг','Время суток'], answer:1,
    explain:'Y — это высота. Море на Y=63, облака на Y=120, а коренная скала на Y=-64.' },

  { id:16, module:'minecraft_1', type:'fill', title:'Команда телепорта', difficulty:2,
    description:'Команда /tp @s 100 70 50 телепортирует игрока на высоту ___?',
    answer:'70', explain:'В /tp X Y Z — Y это высота. Здесь 70 — это координата высоты.' },

  { id:17, module:'minecraft_2', type:'quiz', title:'Команда агенту', difficulty:2,
    description:'Какая команда заставит агента положить блок впереди?',
    options:['agent.move("forward")','agent.place("forward")','agent.destroy("forward")','agent.turn("forward")'], answer:1,
    explain:'agent.place("направление") кладёт блок. agent.destroy ломает блок.' },

  { id:18, module:'minecraft_2', type:'project', title:'Проект: построй дом 5×5', difficulty:3,
    description:'Напиши код агенту, чтобы он построил квадратный дом 5×5 из любого материала. Загрузи скриншот результата.',
    explain:'Используй вложенные циклы или повторение для построения стен.' },

  // ========== DESIGN ==========
  { id:19, module:'design_1', type:'quiz', title:'Сколько пикселей в 16×16?', difficulty:1,
    description:'Сколько всего точек (пикселей) в спрайте 16 на 16?',
    options:['32','64','256','128'], answer:2,
    explain:'16×16 = 256 пикселей. Это базовый размер для классических игровых спрайтов.' },

  { id:20, module:'design_2', type:'quiz', title:'Плавность анимации', difficulty:1,
    description:'Сколько кадров в секунду нужно для плавной анимации?',
    options:['1 кадр','5 кадров','24+ кадров','100 кадров'], answer:2,
    explain:'24 fps — стандарт для кино. Игры обычно используют 30 или 60 fps.' },

  { id:21, module:'design_2', type:'fill', title:'Минимум кадров для ходьбы', difficulty:2,
    description:'Минимальное количество кадров для простой анимации ходьбы (циклической):',
    answer:'4', explain:'4 кадра: ноги вместе → правая вперёд → ноги вместе → левая вперёд. Уже выглядит как ходьба.' },

  // ========== HTML ==========
  { id:22, module:'html_1', type:'quiz', title:'Тег для заголовка', difficulty:1,
    description:'Какой тег создаёт самый большой заголовок?',
    options:['<p>','<h1>','<title>','<big>'], answer:1,
    explain:'<h1> — главный заголовок страницы. h2-h6 — подзаголовки.' },

  { id:23, module:'html_1', type:'quiz', title:'Жирный текст', difficulty:1,
    description:'Какой тег делает текст жирным?',
    options:['<i>','<b> или <strong>','<u>','<em>'], answer:1,
    explain:'<b> или <strong> — жирный. <i> и <em> — курсив. <u> — подчёркнутый.' },

  { id:24, module:'html_1', type:'fill', title:'Найди ошибку', difficulty:2,
    description:'Какой закрывающий тег пропущен? <p>Привет, мир!  ___',
    answer:'</p>', explain:'Каждый открытый тег нужно закрыть. У <p> закрывающий тег — </p>.' },

  { id:25, module:'html_2', type:'quiz', title:'Атрибут src', difficulty:1,
    description:'Что указывают в атрибуте src тега <img>?',
    options:['Размер картинки','Путь или URL картинки','Цвет фона','Текст рядом'], answer:1,
    explain:'src = source (источник). В нём путь к файлу или ссылка из интернета.' },

  { id:26, module:'html_2', type:'fill', title:'Тег строки таблицы', difficulty:2,
    description:'Какой тег создаёт строку в таблице? Напиши без угловых скобок.',
    answer:'tr', explain:'<tr> = table row (строка таблицы). Внутри неё ячейки <td> или заголовки <th>.' },

  { id:27, module:'html_3', type:'fill', title:'CSS — цвет текста', difficulty:1,
    description:'Допиши CSS: p { ____: red; } — чтобы покрасить текст в красный.',
    answer:'color', explain:'Свойство color задаёт цвет текста. background задаёт цвет фона.' },

  { id:28, module:'html_3', type:'quiz', title:'Размер шрифта', difficulty:1,
    description:'Какое CSS-свойство задаёт размер шрифта?',
    options:['text-size','font-size','size','text-height'], answer:1,
    explain:'font-size = размер шрифта. Например: font-size: 18px;' },

  { id:29, module:'html_3', type:'order', title:'Расставь CSS-правило', difficulty:2,
    description:'Расставь части в правильном порядке для покраски заголовка:',
    items:['h1 {','color: blue;','font-size: 32px;','}'],
    explain:'Сначала селектор и открывающая скобка, затем свойства, потом закрывающая скобка.' },

  { id:30, module:'html_4', type:'fill', title:'Включить Flexbox', difficulty:2,
    description:'Какое значение свойства display включает flex-режим? display: ___;',
    answer:'flex', explain:'display: flex — превращает контейнер в flex-контейнер.' },

  { id:31, module:'html_4', type:'quiz', title:'Центрирование по горизонтали', difficulty:2,
    description:'Какое свойство центрирует элементы по горизонтали внутри flex-контейнера?',
    options:['align-items: center','justify-content: center','text-align: center','flex-center'], answer:1,
    explain:'justify-content управляет главной осью (по умолчанию горизонталь), align-items — поперечной.' },

  { id:32, module:'html_4', type:'project', title:'Проект: личная страничка', difficulty:3,
    description:'Создай свою страничку: имя, фото, 3 интереса списком, любимые игры в таблице. Загрузи HTML файл или ссылку.',
    explain:'Используй: h1, img, ul/li, table. Не забудь стили в <style>!' },

  // ========== PYTHON ==========
  { id:33, module:'python_1', type:'quiz', title:'Что выведет print?', difficulty:1,
    description:'Что покажет код:\nprint("Привет", "мир")',
    options:['Приветмир','Привет мир','"Привет" "мир"','Ошибка'], answer:1,
    explain:'print() через запятую разделяет аргументы пробелом по умолчанию.' },

  { id:34, module:'python_1', type:'fill', title:'Заполни пропуск', difficulty:1,
    description:'Какая функция выводит на экран в Python? ___("Привет")',
    answer:'print', explain:'print() — основная функция вывода в Python.' },

  { id:35, module:'python_1', type:'code', title:'Выведи "Привет!" 3 раза', difficulty:1,
    description:'Напиши код, который выведет слово Привет три раза, каждое на новой строке.',
    expectedOutput:'Привет\nПривет\nПривет',
    starter:'# Подсказка: можешь использовать print трижды или цикл for\n',
    explain:'Самый простой способ: 3 раза print("Привет"). Или: for i in range(3): print("Привет")' },

  { id:36, module:'python_2', type:'quiz', title:'Что такое ==?', difficulty:1,
    description:'Чем отличается = от ==?',
    options:['Ничем','= присваивает, == сравнивает','== это ошибка','= умножает'], answer:1,
    explain:'= кладёт значение в переменную. == сравнивает два значения и возвращает True/False.' },

  { id:37, module:'python_2', type:'order', title:'Угадай чётное', difficulty:2,
    description:'Расставь строки кода, чтобы программа проверяла чётность числа n:',
    items:['n = int(input())','if n % 2 == 0:','    print("Чётное")','else:','    print("Нечётное")'],
    explain:'Сначала вводим число, потом проверяем остаток от деления на 2. Если 0 — чётное.' },

  { id:38, module:'python_2', type:'code', title:'Положительное число?', difficulty:2,
    description:'Дано число n = 5. Выведи "Положительное" если n > 0, иначе "Не положительное".',
    expectedOutput:'Положительное',
    starter:'n = 5\n# твой код:\n',
    explain:'Используй if/else с условием n > 0.' },

  { id:39, module:'python_3', type:'fill', title:'Цикл for', difficulty:1,
    description:'Чтобы цикл выполнился 10 раз: for i in ___(10):',
    answer:'range', explain:'range(10) генерирует числа 0..9 — итого 10 итераций.' },

  { id:40, module:'python_3', type:'code', title:'Сумма от 1 до 100', difficulty:2,
    description:'Напиши код, который выведет сумму всех чисел от 1 до 100 включительно.',
    expectedOutput:'5050',
    starter:'# Используй цикл for и переменную-аккумулятор\n',
    explain:'sum = 0; for i in range(1, 101): sum += i; print(sum). Или: print(sum(range(1, 101))).' },

  { id:41, module:'python_3', type:'code', title:'Таблица умножения на 7', difficulty:2,
    description:'Выведи таблицу умножения на 7 от 1 до 10 в формате "7 x 1 = 7" (каждое на новой строке).',
    expectedOutput:'7 x 1 = 7\n7 x 2 = 14\n7 x 3 = 21\n7 x 4 = 28\n7 x 5 = 35\n7 x 6 = 42\n7 x 7 = 49\n7 x 8 = 56\n7 x 9 = 63\n7 x 10 = 70',
    starter:'for i in range(1, 11):\n    # выведи "7 x i = результат"\n',
    explain:'Цикл от 1 до 10. На каждой итерации: print(f"7 x {i} = {7*i}").' },

  { id:42, module:'python_4', type:'fill', title:'Длина строки', difficulty:1,
    description:'Какая функция возвращает длину строки? ___("привет") вернёт 6.',
    answer:'len', explain:'len() возвращает длину строки, списка, словаря и других коллекций.' },

  { id:43, module:'python_4', type:'code', title:'Переверни слово', difficulty:2,
    description:'Дано слово s = "программа". Выведи его задом наперёд.',
    expectedOutput:'аммаргорп',
    starter:'s = "программа"\n# подсказка: используй срез [::-1]\n',
    explain:'s[::-1] — самый короткий способ перевернуть строку.' },

  { id:44, module:'python_4', type:'code', title:'Подсчёт буквы "а"', difficulty:2,
    description:'В тексте "карандаш и бумага" посчитай, сколько раз встречается буква "а".',
    expectedOutput:'5',
    starter:'text = "карандаш и бумага"\n# подсказка: метод .count()\n',
    explain:'text.count("а") — встроенный метод строки.' },

  { id:45, module:'python_4', type:'project', title:'Проект: Угадай животное ', difficulty:3,
    description:'Текстовая игра: программа загадывает животное и даёт 5 подсказок. Пользователь угадывает. Загрузи .py файл или скриншот.',
    explain:'Используй input() для ответа, if/else для проверки, переменную для количества попыток.' },

  // ========== ROBLOX ==========
  { id:46, module:'roblox_1', type:'quiz', title:'Explorer в Roblox Studio', difficulty:1,
    description:'Для чего нужна панель Explorer?',
    options:['Для просмотра кода','Для списка всех объектов в мире','Для запуска игры','Для покраски кирпичей'], answer:1,
    explain:'Explorer показывает иерархию объектов сцены (как дерево файлов).' },

  { id:47, module:'roblox_1', type:'quiz', title:'Где менять цвет?', difficulty:1,
    description:'В какой панели можно изменить цвет выбранного кирпича?',
    options:['Explorer','Properties','Toolbox','Output'], answer:1,
    explain:'Properties — там все свойства выбранного объекта (цвет, материал, размер).' },

  { id:48, module:'roblox_2', type:'fill', title:'script.Parent', difficulty:2,
    description:'Что возвращает script.Parent? (объект...)',
    answer:'в котором находится скрипт', explain:'script.Parent = родитель скрипта = объект, внутри которого создан этот скрипт.' },

  { id:49, module:'roblox_2', type:'quiz', title:'Событие касания', difficulty:2,
    description:'Какое событие срабатывает при касании Part?',
    options:['Click','Touched','Hovered','Selected'], answer:1,
    explain:'Touched — событие касания. Click — для клика мышью (нужен ClickDetector).' },

  // ========== CYBER ==========
  { id:50, module:'cyber_1', type:'quiz', title:'Самый надёжный пароль', difficulty:1,
    description:'Какой пароль самый надёжный?',
    options:['123456','qwerty','Mb_2025!Tigr','myname'], answer:2,
    explain:'Mb_2025!Tigr — длинный, есть большие/маленькие буквы, цифры, спецсимвол.' },

  { id:51, module:'cyber_1', type:'quiz', title:'Минимум символов', difficulty:1,
    description:'Сколько символов должно быть в надёжном пароле минимум?',
    options:['4','6','8','12+'], answer:3,
    explain:'Современный стандарт — минимум 12 символов. Чем длиннее, тем безопаснее.' },

  { id:52, module:'cyber_2', type:'quiz', title:'Признак фишинга', difficulty:2,
    description:'Что НЕ является признаком фишингового письма?',
    options:['Угроза заблокировать аккаунт за 24 часа','Странный домен отправителя','Письмо от знакомого о встрече','Просьба ввести пароль по ссылке'], answer:2,
    explain:'Письмо от знакомого с обычной просьбой — норма. Все остальные — красные флаги.' },

  { id:53, module:'cyber_3', type:'quiz', title:'Откуда вирус?', difficulty:1,
    description:'Какой способ НЕ заразит компьютер вирусом?',
    options:['Скачивание пиратской игры','Открытие письма от друга с обычным текстом','Подключение чужой флешки','Клик по подозрительной рекламе'], answer:1,
    explain:'Обычное письмо с текстом не опасно. Опасны вложения и ссылки.' },

  { id:54, module:'cyber_3', type:'project', title:'Памятка по безопасности', difficulty:2,
    description:'Составь 5 правил защиты компьютера. Запиши и загрузи документ или скриншот.',
    explain:'Например: 1) обновляй ОС, 2) антивирус, 3) сложные пароли, 4) не скачивай пиратку, 5) бэкапы.' },

  // ========== PYTHON PRO ==========
  { id:55, module:'pythonpro_1', type:'code', title:'Топ-3 оценок', difficulty:2,
    description:'Дан список оценок класса grades = [4, 5, 3, 5, 4, 5, 2, 4, 5, 3]. Выведи 3 самые большие оценки в порядке убывания через пробел.',
    expectedOutput:'5 5 5',
    starter:'grades = [4, 5, 3, 5, 4, 5, 2, 4, 5, 3]\n# подсказка: sorted(..., reverse=True)[:3]\n',
    explain:'sorted(grades, reverse=True)[:3] — отсортировать по убыванию и взять первые 3.' },

  { id:56, module:'pythonpro_1', type:'fill', title:'Добавить в список', difficulty:1,
    description:'Какой метод добавляет элемент в конец списка? list.___(7)',
    answer:'append', explain:'list.append(x) добавляет x в конец списка.' },

  { id:57, module:'pythonpro_2', type:'code', title:'Функция куба', difficulty:2,
    description:'Напиши функцию cube(x), которая возвращает x в третьей степени. Вызови cube(4) и выведи результат.',
    expectedOutput:'64',
    starter:'def cube(x):\n    # верни x^3\n    pass\n\nprint(cube(4))',
    explain:'return x * x * x или return x ** 3.' },

  { id:58, module:'pythonpro_2', type:'code', title:'Калькулятор сумм', difficulty:2,
    description:'Напиши функцию add(a, b) которая возвращает сумму, и выведи add(15, 27).',
    expectedOutput:'42',
    starter:'def add(a, b):\n    pass\n\nprint(add(15, 27))',
    explain:'return a + b — всё просто!' },

  { id:59, module:'pythonpro_3', type:'quiz', title:'Открыть файл на чтение', difficulty:2,
    description:'Какой режим открытия файла используется для чтения?',
    options:['"w"','"r"','"a"','"x"'], answer:1,
    explain:'"r" = read (чтение), "w" = write (запись, очистит файл), "a" = append (дописать).' },

  { id:60, module:'pythonpro_4', type:'quiz', title:'__init__', difficulty:2,
    description:'Метод __init__ в классе:',
    options:['Удаляет объект','Конструктор: вызывается при создании','Печатает объект','Закрывает программу'], answer:1,
    explain:'__init__ — конструктор. Вызывается автоматически когда мы пишем MyClass().' },

  { id:61, module:'pythonpro_4', type:'code', title:'Класс BankAccount', difficulty:3,
    description:'Создай класс BankAccount с балансом. Метод deposit(сумма) добавляет. Сделай счёт, положи 1000, добавь 500, выведи баланс.',
    expectedOutput:'1500',
    starter:'class BankAccount:\n    def __init__(self):\n        self.balance = 0\n    def deposit(self, amount):\n        # увеличь баланс\n        pass\n\na = BankAccount()\na.deposit(1000)\na.deposit(500)\nprint(a.balance)',
    explain:'self.balance += amount — это всё что нужно дописать в deposit.' },

  { id:62, module:'pythonpro_5', type:'quiz', title:'Сложность бинарного поиска', difficulty:3,
    description:'Какая асимптотическая сложность бинарного поиска?',
    options:['O(1)','O(log n)','O(n)','O(n²)'], answer:1,
    explain:'Бинарный поиск каждый раз делит пополам — отсюда логарифмическая сложность O(log n).' },

  { id:63, module:'pythonpro_5', type:'project', title:'Проект: Telegram-бот', difficulty:3,
    description:'Создай простого Telegram-бота на python-telegram-bot или aiogram. Бот должен отвечать на /start. Загрузи .py файл или ссылку на бота.',
    explain:'Используй BotFather для создания токена. Библиотека aiogram — простая и современная.' },

  // ========== JAVA ==========
  { id:64, module:'java_1', type:'quiz', title:'Точка с запятой', difficulty:1,
    description:'Что должно стоять в конце каждой строки кода в Java?',
    options:['Точка','Точка с запятой ;','Двоеточие','Ничего'], answer:1,
    explain:'В Java каждая инструкция заканчивается ; — иначе ошибка компиляции.' },

  { id:65, module:'java_1', type:'fill', title:'Чтение строки', difficulty:2,
    description:'Какой метод Scanner читает строку текста? scanner.____()',
    answer:'nextLine', explain:'nextLine() — целая строка. nextInt() — целое число. next() — одно слово.' },

  { id:66, module:'java_2', type:'quiz', title:'Конструктор класса', difficulty:2,
    description:'Как называется метод-конструктор класса Student?',
    options:['init','Student','create','new'], answer:1,
    explain:'В Java конструктор всегда называется как сам класс.' },

  { id:67, module:'java_3', type:'quiz', title:'ArrayList — добавить', difficulty:2,
    description:'Какой метод добавляет элемент в ArrayList?',
    options:['.push()','.add()','.append()','.insert()'], answer:1,
    explain:'В Java ArrayList: add(элемент). А в Python — append().' },

  { id:68, module:'java_4', type:'quiz', title:'Ключевое слово наследования', difficulty:2,
    description:'Какое ключевое слово используется для наследования в Java?',
    options:['inherits','extends','implements','base'], answer:1,
    explain:'class Circle extends Shape — Circle наследует Shape.' },

  // ========== C++ ==========
  { id:69, module:'cpp_1', type:'quiz', title:'Объявить целое число', difficulty:1,
    description:'Как объявить целочисленную переменную x = 5 в C++?',
    options:['var x = 5;','int x = 5;','let x = 5;','x: int = 5'], answer:1,
    explain:'C++ требует указать тип: int (целое), double (дробное), string (строка).' },

  { id:70, module:'cpp_1', type:'fill', title:'Вывод в C++', difficulty:1,
    description:'Какой оператор используется для вывода в C++? ____ << "Hello";',
    answer:'cout', explain:'cout (от console output) — стандартный поток вывода в C++.' },

  { id:71, module:'cpp_2', type:'quiz', title:'Простое число', difficulty:2,
    description:'Какое из чисел простое?',
    options:['9','15','17','21'], answer:2,
    explain:'17 делится только на 1 и на 17. 9=3*3, 15=3*5, 21=3*7.' },

  { id:72, module:'cpp_3', type:'fill', title:'Размер массива', difficulty:2,
    description:'Метод вектора, возвращающий количество элементов: v.____()',
    answer:'size', explain:'v.size() — текущая длина вектора. v.empty() — проверка пустоты.' },

  { id:73, module:'cpp_4', type:'quiz', title:'Факториал 5', difficulty:2,
    description:'Чему равен 5! (факториал 5)?',
    options:['25','120','24','60'], answer:1,
    explain:'5! = 5×4×3×2×1 = 120.' },

  { id:74, module:'cpp_4', type:'project', title:'Проект: Виселица', difficulty:3,
    description:'Напиши консольную игру "Виселица" на C++. Загадывается слово, игрок угадывает буквы, 6 попыток. Загрузи .cpp файл.',
    explain:'Используй массив угаданных букв, цикл while и проверку через .find().' },

  // ========== UNITY ==========
  { id:75, module:'unity_1', type:'quiz', title:'Главный компонент', difficulty:1,
    description:'Какой компонент есть у КАЖДОГО GameObject?',
    options:['Rigidbody','Transform','Collider','MeshRenderer'], answer:1,
    explain:'Transform — отвечает за позицию/поворот/масштаб. Без него объекта не существовало бы в пространстве.' },

  { id:76, module:'unity_1', type:'quiz', title:'Что нужно для физики?', difficulty:2,
    description:'Чтобы объект подчинялся гравитации, нужно добавить:',
    options:['Collider','Rigidbody','Material','Animator'], answer:1,
    explain:'Rigidbody включает физический симулятор для объекта. Collider — это только форма столкновений.' },

  { id:77, module:'unity_2', type:'fill', title:'Метод Update', difficulty:2,
    description:'Метод, который вызывается каждый кадр в Unity: void ___() { ... }',
    answer:'Update', explain:'Update() вызывается ~60 раз в секунду. Start() — один раз при запуске.' },

  { id:78, module:'unity_3', type:'quiz', title:'OnTriggerEnter', difficulty:2,
    description:'Когда вызывается OnTriggerEnter?',
    options:['При нажатии кнопки','Когда два коллайдера соприкоснулись (триггер)','При старте сцены','При выходе из игры'], answer:1,
    explain:'OnTriggerEnter срабатывает когда объект входит в зону триггера (Collider с isTrigger=true).' },

  // ========== BLENDER ==========
  { id:79, module:'blender_1', type:'fill', title:'Горячая клавиша масштаба', difficulty:1,
    description:'Какой клавишей в Blender масштабируют объект? (одна буква)',
    answer:'s', explain:'S = Scale. G = Grab (двигать). R = Rotate (вращать).' },

  { id:80, module:'blender_1', type:'quiz', title:'Edit Mode', difficulty:1,
    description:'Что можно делать в Edit Mode?',
    options:['Двигать объект','Редактировать вершины и грани','Рендерить','Запускать игру'], answer:1,
    explain:'Edit Mode — для работы с геометрией: вершинами, рёбрами, гранями. Объект целиком двигают в Object Mode.' },

  { id:81, module:'blender_2', type:'quiz', title:'Добавить объект', difficulty:1,
    description:'Сочетание клавиш для добавления объекта:',
    options:['Ctrl+A','Shift+A','Alt+A','A'], answer:1,
    explain:'Shift+A открывает меню добавления (Mesh, Light, Camera).' },

  { id:82, module:'blender_3', type:'fill', title:'Ключевой кадр', difficulty:2,
    description:'Какая клавиша добавляет ключевой кадр в Blender?',
    answer:'i', explain:'I (Insert keyframe) — добавляет ключ для выбранного свойства (Location/Rotation/Scale).' },

  { id:83, module:'blender_3', type:'project', title:'Проект: анимация персонажа', difficulty:3,
    description:'Создай персонажа в Blender и сделай анимацию 5-10 секунд (ходьба, прыжок, или взмах руки). Загрузи видео-рендер.',
    explain:'Используй keyframes на Location и Rotation. Финал — рендер видео.' },

  // ========== DATA SCIENCE ==========
  { id:84, module:'ds_1', type:'fill', title:'Среднее в pandas', difficulty:2,
    description:'Метод pandas Series для среднего арифметического: df["math"].____()',
    answer:'mean', explain:'.mean() — среднее. .median() — медиана. .max() — максимум.' },

  { id:85, module:'ds_1', type:'quiz', title:'Первые строки DataFrame', difficulty:1,
    description:'Какой метод покажет первые 5 строк DataFrame?',
    options:['.first()','.head()','.top()','.show()'], answer:1,
    explain:'df.head() — первые 5 строк. df.head(10) — первые 10. df.tail() — последние.' },

  { id:86, module:'ds_2', type:'fill', title:'Столбчатый график', difficulty:2,
    description:'Какая функция matplotlib рисует столбчатую диаграмму? plt.____()',
    answer:'bar', explain:'plt.bar(x, y) — столбцы. plt.plot — линия. plt.scatter — точки.' },

  { id:87, module:'ds_3', type:'code', title:'Сумма цифр числа', difficulty:3,
    description:'Дано число n = 12345. Найди сумму его цифр.',
    expectedOutput:'15',
    starter:'n = 12345\n# Подсказка: используй while и % 10\n',
    explain:'s=0; while n>0: s+=n%10; n//=10. Или: print(sum(int(d) for d in str(n))).' },

  { id:88, module:'ds_3', type:'code', title:'Палиндром или нет?', difficulty:3,
    description:'Дано слово s = "топот". Выведи "да" если палиндром (читается одинаково в обе стороны), иначе "нет".',
    expectedOutput:'да',
    starter:'s = "топот"\n# Подсказка: s == s[::-1]\n',
    explain:'Если s == s[::-1] — палиндром. Иначе — нет.' },

  { id:89, module:'ds_3', type:'project', title:'Проект: анализ погоды', difficulty:3,
    description:'Найди CSV с погодой за месяц (или сделай свой). Построй график температуры по дням и выведи средние/мин/макс значения.',
    explain:'pandas для данных + matplotlib для графика. Хорошо иметь подписи и легенду.' },

  // ========== ИНТЕРАКТИВНЫЕ ЗАДАЧИ (Scratch / HTML+CSS / Blockly) ==========

  // ----- SCRATCH (TurboWarp embed) -----
  { id:101, module:'scratch_1', type:'scratch', title:'Создай анимацию кота', difficulty:1,
    description:'Открой редактор ниже и сделай простую анимацию: когда нажат флажок → всегда → следующий костюм, ждать 0.2 сек. Кот должен бежать на месте.',
    explain:'Блок «следующий костюм» + пауза дают эффект анимации.' },

  { id:102, module:'scratch_2', type:'scratch', title:'Управляй котом стрелками', difficulty:2,
    description:'Сделай так, чтобы кот двигался влево/вправо при нажатии стрелок (внутри блока «всегда» — два «если»).',
    explain:'Используй «клавиша вправо нажата?» + «изменить x на 10».' },

  // ----- HTML+CSS (split-editor) -----
  { id:103, module:'html_1', type:'htmlcss', title:'Раскрась заголовок', difficulty:1,
    description:'Сделай заголовок красным. Подсказка: добавь атрибут style или встроить <style>.',
    starter:'<h1>Привет!</h1>',
    expectedOutput:'color:red',
    explain:'Пример: <h1 style="color:red">Привет!</h1>. Или <style>h1{color:red}</style>.' },

  { id:104, module:'html_1', type:'htmlcss', title:'Сделай кнопку', difficulty:2,
    description:'Создай с нуля кнопку с текстом «Нажми меня». Оформи её: фон синий, текст белый, отступы внутри.',
    starter:'',
    explain:'Пример: <button style="background:#3b82f6;color:#fff;padding:10px 18px;border:0;border-radius:8px">Нажми меня</button>.' },

  // ----- BLOCKLY (workspace + JS-gen) -----
  { id:105, module:'scratch_3', type:'blockly', title:'Цикл 10 раз', difficulty:1,
    description:'Собери блоками цикл, который повторится 10 раз и на каждом шаге печатает слово «hi». Нажми «Сгенерировать JavaScript».',
    expectedOutput:'for (var count = 0; count < 10;',
    explain:'Категория Loops → «повторить 10 раз». Внутрь — блок Text print со строкой hi.' },

  { id:106, module:'scratch_3', type:'blockly', title:'Если переменная > 5', difficulty:2,
    description:'Создай переменную x, присвой ей число 7. Добавь блок «если x > 5» — внутрь напечатай «big». Сгенерируй JS.',
    expectedOutput:'if (x > 5)',
    explain:'Logic → if + compare > ; Variables → set x to 7 ; Text → print("big").' },

  // ========== JAVA — интерактивные задачи с авто-проверкой через Piston ==========
  { id:201, module:'java_1', type:'java', title:'Приветствие на Java', difficulty:1,
    description:'Напиши программу, которая выведёт ровно строку Hello, Java!',
    expectedOutput:'Hello, Java!',
    starter:'public class Main {\n    public static void main(String[] args) {\n        // выведи здесь строку\n        \n    }\n}\n',
    explain:'Используй System.out.println("Hello, Java!").' },

  { id:202, module:'java_1', type:'java', title:'Сумма двух чисел', difficulty:2,
    description:'Считай из ввода два целых числа (в разных строках) и выведи их сумму.',
    stdin:'7\n13\n',
    expectedOutput:'20',
    starter:'import java.util.Scanner;\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int a = sc.nextInt();\n        int b = sc.nextInt();\n        // выведи сумму\n        \n    }\n}\n',
    explain:'System.out.println(a + b);' },

  // ========== C++ — интерактивные задачи ==========
  { id:203, module:'cpp_1', type:'cpp', title:'Первая программа на C++', difficulty:1,
    description:'Напиши программу, которая выведёт Hello, C++!',
    expectedOutput:'Hello, C++!',
    starter:'#include <iostream>\nusing namespace std;\nint main() {\n    // выведи строку\n    \n    return 0;\n}\n',
    explain:'cout << "Hello, C++!" << endl;' },

  { id:204, module:'cpp_2', type:'cpp', title:'Квадрат числа', difficulty:2,
    description:'Считай целое число со ввода и выведи его квадрат.',
    stdin:'9\n',
    expectedOutput:'81',
    starter:'#include <iostream>\nusing namespace std;\nint main() {\n    int n;\n    cin >> n;\n    // выведи n*n\n    \n    return 0;\n}\n',
    explain:'cout << n*n << endl;' },

  // === ДОПОЛНИТЕЛЬНЫЕ JAVA ===
  { id:205, module:'java_1', type:'java', title:'Имя и приветствие', difficulty:2,
    description:'Считай строку со ввода и выведи Hello, <имя>!',
    stdin:'Алия\n',
    expectedOutput:'Hello, Алия!',
    starter:'import java.util.Scanner;\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        String name = sc.nextLine();\n        // выведи приветствие\n        \n    }\n}\n',
    explain:'System.out.println("Hello, " + name + "!");' },

  { id:206, module:'java_2', type:'java', title:'Чётное или нечётное', difficulty:2,
    description:'Считай число. Если чётное — выведи even, иначе odd.',
    stdin:'7\n',
    expectedOutput:'odd',
    starter:'import java.util.Scanner;\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n        // if (n % 2 == 0) ...\n        \n    }\n}\n',
    explain:'Используй if-else и оператор %.' },

  { id:207, module:'java_3', type:'java', title:'Сумма от 1 до N', difficulty:2,
    description:'Считай N. Выведи сумму 1+2+...+N.',
    stdin:'10\n',
    expectedOutput:'55',
    starter:'import java.util.Scanner;\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n        int sum = 0;\n        // for (int i = 1; i <= n; i++) sum += i;\n        \n        System.out.println(sum);\n    }\n}\n',
    explain:'Цикл for от 1 до n включительно.' },

  { id:208, module:'java_4', type:'java', title:'Максимум из трёх', difficulty:3,
    description:'Считай 3 числа в разных строках. Выведи наибольшее из них.',
    stdin:'4\n9\n2\n',
    expectedOutput:'9',
    starter:'import java.util.Scanner;\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int a = sc.nextInt(), b = sc.nextInt(), c = sc.nextInt();\n        // используй Math.max\n        \n    }\n}\n',
    explain:'Math.max(a, Math.max(b, c))' },

  // === ДОПОЛНИТЕЛЬНЫЕ C++ ===
  { id:209, module:'cpp_1', type:'cpp', title:'Сумма двух чисел (C++)', difficulty:2,
    description:'Считай два целых числа и выведи их сумму.',
    stdin:'12 30\n',
    expectedOutput:'42',
    starter:'#include <iostream>\nusing namespace std;\nint main() {\n    int a, b;\n    cin >> a >> b;\n    // cout << ...\n    \n    return 0;\n}\n',
    explain:'cout << a + b << endl;' },

  { id:210, module:'cpp_2', type:'cpp', title:'Проверка положительности', difficulty:2,
    description:'Считай число. Если > 0 — выведи positive, если < 0 — negative, иначе zero.',
    stdin:'-5\n',
    expectedOutput:'negative',
    starter:'#include <iostream>\nusing namespace std;\nint main() {\n    int n;\n    cin >> n;\n    // if/else if/else\n    \n    return 0;\n}\n',
    explain:'Цепочка if / else if / else.' },

  { id:211, module:'cpp_3', type:'cpp', title:'Произведение элементов', difficulty:3,
    description:'Считай N, потом N чисел. Выведи их произведение.',
    stdin:'4\n2 3 4 5\n',
    expectedOutput:'120',
    starter:'#include <iostream>\nusing namespace std;\nint main() {\n    int n;\n    cin >> n;\n    long long p = 1;\n    for (int i = 0; i < n; i++) {\n        int x; cin >> x;\n        // p *= x;\n    }\n    cout << p << endl;\n    return 0;\n}\n',
    explain:'Накопление в переменную p через *=.' },

  { id:212, module:'cpp_4', type:'cpp', title:'Факториал N', difficulty:3,
    description:'Считай N (1 ≤ N ≤ 12). Выведи N! (факториал).',
    stdin:'6\n',
    expectedOutput:'720',
    starter:'#include <iostream>\nusing namespace std;\nint main() {\n    int n;\n    cin >> n;\n    long long f = 1;\n    // for (int i = 2; i <= n; i++) f *= i;\n    \n    cout << f << endl;\n    return 0;\n}\n',
    explain:'Можно циклом или рекурсией.' },
];

/* ===== ЗНАЧКИ (achievements) ===== */
const BADGES = [
  { id:'first_code', icon:'https://cdn-icons-png.flaticon.com/512/3306/3306967.png', name:'Первый код',     desc:'Реши первую задачу-код' },
  { id:'loop_master', icon:'https://cdn-icons-png.flaticon.com/512/8090/8090669.png', name:'Мастер циклов',   desc:'Реши 5 задач на циклы' },
  { id:'debugger', icon:'https://cdn-icons-png.flaticon.com/512/1067/1067256.png', name:'Дебаггер',        desc:'Найди 5 ошибок в коде' },
  { id:'project_hero', icon:'https://cdn-icons-png.flaticon.com/512/2583/2583344.png', name:'Проектный герой', desc:'Сдай 3 проекта' },
  { id:'python_ninja', icon:'https://cdn-icons-png.flaticon.com/512/919/919852.png', name:'Python-ниндзя',   desc:'Реши все задачи Python' },
  { id:'streak_3', icon:'https://cdn-icons-png.flaticon.com/512/785/785116.png', name:'Огонёк (3 дня)',   desc:'3 дня подряд решаешь задачи' },
  { id:'streak_7', icon:'https://cdn-icons-png.flaticon.com/512/2917/2917995.png', name:'Молния (7 дней)',  desc:'Неделя без перерыва!' },
  { id:'streak_30', icon:'https://cdn-icons-png.flaticon.com/512/2278/2278984.png', name:'Легенда Kursor',  desc:'30 дней подряд!' },
  { id:'quiz_master', icon:'https://cdn-icons-png.flaticon.com/512/3209/3209265.png', name:'Знаток тестов',    desc:'10 тестов без ошибок' },
  { id:'speedster', icon:'https://cdn-icons-png.flaticon.com/512/3132/3132693.png', name:'Скоростной',       desc:'Реши задачу меньше чем за минуту' },
  { id:'no_hints', icon:'https://cdn-icons-png.flaticon.com/512/1828/1828884.png', name:'Без подсказок',    desc:'Реши 10 задач без подсказок' },
  { id:'beginner', icon:'https://cdn-icons-png.flaticon.com/512/616/616494.png', name:'Начинающий',       desc:'Зарегистрировался' },
];

// Экспортируем глобально для всех страниц
window.KURSOR_DB = { LANGS, GROUPS, MODULES, TASKS, BADGES, MASCOT, LOGO };
