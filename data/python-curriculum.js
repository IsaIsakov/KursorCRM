'use strict';

// A maintainable, source-controlled curriculum. Each topic contains a lesson,
// a checkpoint and seven varied tasks (112 tasks total across both tracks).
const tracks = [
  {
    track: 'Python', level: 'База', prefix: 'python',
    topics: [
      ['start', 'Старт: ввод, вывод и выражения', 'Научись превращать условие в короткую программу и проверять результат.', 'print, input, арифметические выражения и порядок действий', 'Сначала понять входные данные, затем вычислить результат и только потом вывести его.', 'print', ['прочитать условие','получить данные','вычислить','вывести результат'], 'P2Spqz_CXM8', 2200,
        ['print(7 + 5 * 2)', '17'], ['name = "Алия"\nprint("Привет,", name)', 'Привет, Алия']],
      ['types', 'Переменные и типы данных', 'Работай с числами, строками и преобразованиями без случайных ошибок.', 'int, float, str, bool, type и явные преобразования', 'input всегда возвращает строку; для вычислений данные нужно преобразовать.', 'int', ['получить строку','проверить формат','преобразовать тип','выполнить вычисление'], 'P2Spqz_CXM8', 3399,
        ['age = int("12")\nprint(age + 3)', '15'], ['price = 1250\ncount = 4\nprint(price * count)', '5000']],
      ['conditions', 'Логика и условия', 'Строй точные правила принятия решений и не путай независимые проверки.', 'сравнения, and/or/not, if/elif/else и граничные случаи', 'elif проверяется только если предыдущие ветви не сработали.', 'elif', ['сформулировать правило','найти границы','записать ветви','проверить крайние случаи'], 'P2Spqz_CXM8', 4765,
        ['score = 87\nprint("A" if score >= 85 else "B")', 'A'], ['x = 12\nprint(x > 10 and x % 2 == 0)', 'True']],
      ['loops', 'Циклы без путаницы', 'Автоматизируй повторения и уверенно управляй диапазонами.', 'for, while, range, break, continue и накопители', 'range не включает правую границу; while обязан менять условие остановки.', 'range', ['выбрать повторение','задать состояние','обновить состояние','проверить остановку'], 'P2Spqz_CXM8', 5678,
        ['total = 0\nfor x in range(1, 5):\n    total += x\nprint(total)', '10'], ['print(*[x*x for x in range(4)])', '0 1 4 9']],
      ['collections', 'Списки, кортежи и множества', 'Выбирай структуру данных под задачу, а не по привычке.', 'индексы, срезы, методы списка, tuple и set', 'Список хранит порядок и меняется; множество быстро убирает повторы.', 'set', ['выбрать структуру','создать данные','изменить или прочитать','проверить результат'], 'P2Spqz_CXM8', 7257,
        ['nums = [3, 1, 3, 2]\nprint(len(set(nums)))', '3'], ['a = [10, 20, 30, 40]\nprint(a[1:3])', '[20, 30]']],
      ['dicts', 'Словари и модели данных', 'Описывай реальные объекты и безопасно работай с отсутствующими ключами.', 'ключи, значения, get, items и вложенные структуры', 'get позволяет задать значение по умолчанию и не падать с KeyError.', 'get', ['определить поля','создать словарь','прочитать безопасно','обновить данные'], 'cfJrtx-k96U', 18500,
        ['user = {"name": "Dana", "score": 9}\nprint(user["score"])', '9'], ['d = {"a": 2, "b": 3}\nprint(sum(d.values()))', '5']],
      ['functions', 'Функции и декомпозиция', 'Разбивай решение на понятные части с ясными контрактами.', 'параметры, return, область видимости и чистые функции', 'print показывает значение человеку, return возвращает его вызывающему коду.', 'return', ['назвать действие','определить параметры','вычислить результат','вернуть результат'], 'cfJrtx-k96U', 8200,
        ['def twice(x):\n    return x * 2\nprint(twice(6))', '12'], ['def greet(name="друг"):\n    return f"Привет, {name}!"\nprint(greet("Мира"))', 'Привет, Мира!']],
      ['files_project', 'Файлы, ошибки и итоговый проект', 'Собери устойчивую консольную программу, которая хранит и проверяет данные.', 'with open, кодировки, try/except, модули и проектирование проекта', 'Лови только ожидаемые исключения и всегда объясняй пользователю, что пошло не так.', 'except', ['проверить вход','выполнить опасную операцию','обработать ожидаемую ошибку','сохранить результат'], 'cfJrtx-k96U', 26500,
        ['try:\n    print(int("42"))\nexcept ValueError:\n    print("ошибка")', '42'], ['from pathlib import Path\np = Path("notes.txt")\nprint(p.suffix)', '.txt']],
    ]
  },
  {
    track: 'Python Pro', level: 'Продвинутый', prefix: 'python_pro',
    topics: [
      ['pythonic', 'Pythonic-код и comprehensions', 'Пиши выразительный код без потери читаемости.', 'comprehensions, enumerate, zip, распаковка и сортировка по ключу', 'Comprehension хорош для одного ясного преобразования; сложную логику оставляй обычному циклу.', 'enumerate', ['сформулировать преобразование','выбрать источник','добавить условие','проверить читаемость'], 'cfJrtx-k96U', 17500,
        ['print([x*x for x in range(6) if x % 2])', '[1, 9, 25]'], ['a, *middle, b = [1, 2, 3, 4]\nprint(a, middle, b)', '1 [2, 3] 4']],
      ['functions', 'Функции высокого уровня', 'Используй функции как данные и проектируй гибкие интерфейсы.', '*args, **kwargs, lambda, замыкания и функции высшего порядка', 'Замыкание помнит значения внешней области даже после завершения внешней функции.', 'lambda', ['определить контракт','передать поведение','выполнить функцию','вернуть результат'], 'cfJrtx-k96U', 20500,
        ['def make(n):\n    return lambda x: x + n\nprint(make(5)(7))', '12'], ['items = [("b", 2), ("a", 3)]\nprint(sorted(items, key=lambda x: x[1]))', "[('b', 2), ('a', 3)]"]],
      ['oop', 'ООП: модели и композиция', 'Создавай объекты с валидным состоянием и понятной ответственностью.', 'классы, экземпляры, свойства, методы, dataclass и композиция', 'Композиция обычно проще наследования: объект получает нужные возможности через поля.', '__init__', ['выделить ответственность','описать состояние','защитить инварианты','добавить поведение'], 'cfJrtx-k96U', 23000,
        ['class Box:\n    def __init__(self, value): self.value = value\nprint(Box(8).value)', '8'], ['from dataclasses import dataclass\n@dataclass\nclass Point: x:int; y:int\nprint(Point(2, 3))', 'Point(x=2, y=3)']],
      ['protocols', 'Протоколы и магические методы', 'Делай свои типы естественной частью языка Python.', '__repr__, __len__, сравнение, итерация и утинная типизация', 'Протокол описывает требуемое поведение, а не конкретного предка класса.', '__len__', ['выбрать протокол','реализовать метод','сохранить инвариант','проверить встроенной функцией'], 'cfJrtx-k96U', 24200,
        ['class Bag:\n    def __init__(self): self.items=[1,2,3]\n    def __len__(self): return len(self.items)\nprint(len(Bag()))', '3'], ['class A:\n    def __repr__(self): return "A()"\nprint([A()])', '[A()]']],
      ['generators', 'Итераторы и генераторы', 'Обрабатывай большие потоки без загрузки всего в память.', 'iter, next, yield, генераторные выражения и ленивые вычисления', 'Генератор хранит состояние между yield и вычисляет следующий элемент по запросу.', 'yield', ['создать источник','выдать элемент','сохранить состояние','остановиться естественно'], 'cfJrtx-k96U', 25200,
        ['def odds():\n    for x in range(5):\n        if x % 2: yield x\nprint(list(odds()))', '[1, 3]'], ['g = (x*2 for x in range(3))\nprint(next(g), next(g))', '0 2']],
      ['decorators', 'Декораторы и контекстные менеджеры', 'Добавляй сквозное поведение и гарантированно освобождай ресурсы.', 'декораторы, functools.wraps, with и contextmanager', 'Декоратор оборачивает функцию; wraps сохраняет её имя и документацию.', 'wraps', ['принять функцию','создать обёртку','сохранить метаданные','вернуть обёртку'], 'cfJrtx-k96U', 27400,
        ['def deco(fn):\n    return lambda: "[" + fn() + "]"\n@deco\ndef hi(): return "ok"\nprint(hi())', '[ok]'], ['from contextlib import nullcontext\nwith nullcontext(7) as x:\n    print(x)', '7']],
      ['quality', 'Типизация, тесты и отладка', 'Проверяй идеи автоматически и находи ошибки по доказательствам.', 'type hints, dataclass, assert, unittest, logging и граничные тесты', 'Типы помогают инструментам, но реальные гарантии дают тесты и проверка входных данных.', 'assert', ['задать ожидаемое поведение','подготовить данные','выполнить действие','сравнить результат'], 'cfJrtx-k96U', 29200,
        ['def add(a: int, b: int) -> int: return a+b\nassert add(2, 3) == 5\nprint("OK")', 'OK'], ['cases = [0, 1, -1]\nprint(len(cases))', '3']],
      ['algorithms_project', 'Алгоритмы, async и архитектура проекта', 'Собери финальный проект с измеримой сложностью и асинхронными операциями.', 'Big O, поиск, стек/очередь, asyncio, слои приложения и финальный проект', 'Сначала выбери структуру данных и оцени сложность, затем оптимизируй только измеренное узкое место.', 'asyncio', ['описать данные','выбрать алгоритм','измерить сложность','проверить контракт'], 'cfJrtx-k96U', 31000,
        ['from collections import deque\nq=deque([1,2]); q.append(3)\nprint(q.popleft(), list(q))', '1 [2, 3]'], ['import asyncio\nasync def main(): return 42\nprint(asyncio.run(main()))', '42']],
    ]
  }
];

function makeLesson(track, level, prefix, topic, index, previousId) {
  const [slug, title, description, concepts, insight, keyword, order, videoId, videoStart, trace, practice] = topic;
  const moduleId = `${prefix}_${String(index + 1).padStart(2, '0')}_${slug}`;
  const video = `https://www.youtube.com/embed/${videoId}?start=${videoStart}&rel=0`;
  const task = (type, name, extra = {}) => ({ type, title: name, description: extra.description || '', difficulty: extra.difficulty || 1, explain: extra.explain || insight, ...extra });
  return {
    moduleId, lang: 'python', track, level, estimatedMin: index === 7 ? 150 : 90,
    prerequisiteId: previousId || '', title: `${index + 1}. ${title}`, description,
    intro: [
      { emoji: track === 'Python Pro' ? '🧠' : '🐍', title: 'Зачем это нужно', body: `<p>${description}</p><p><b>Результат урока:</b> ты сможешь применить тему в новой задаче, а не только повторить пример.</p>`, video },
      { emoji: '🗺️', title: 'Карта темы', body: `<p><b>Ключевые инструменты:</b> ${concepts}.</p><p>${insight}</p>` },
      { emoji: '🔬', title: 'Разбираем на примере', body: '<p>Прочитай код построчно. Перед запуском обязательно предскажи вывод — это быстрее всего развивает инженерное мышление.</p>', code: trace[0] },
      { emoji: '✅', title: 'Проверка понимания', body: `<p>Объясни своими словами: «${insight}» Затем измени пример и предскажи новый результат.</p>` },
      { emoji: '🚀', title: 'Практика и рост', body: '<p>Решай сначала без подсказки. После ошибки сравни ожидание с фактом, назови причину и только затем исправляй код.</p>' },
    ],
    miniTask: { title: 'Прогноз перед запуском', description: `Какой результат даст пример? Проверь себя и объясни каждую строку.`, code: trace[0], answer: trace[1] },
    tasks: [
      task('quiz', 'Понимание главной идеи', { description: `Какое утверждение точнее всего описывает тему «${title}»?`, options: [insight, 'Всегда нужно писать как можно больше строк', 'Ошибки следует скрывать без обработки', 'Тип данных никогда не влияет на решение'], answer: 0, explain: insight }),
      task('fill', `Ключевой инструмент: ${keyword}`, { description: `Впиши ключевое слово или имя метода: ${concepts}.`, answer: keyword }),
      task('order', 'Алгоритм решения', { description: 'Расположи инженерные шаги в рабочем порядке.', items: order }),
      task('code', 'Предскажи и воспроизведи вывод', { description: 'Запусти мысленно, затем допиши или перепиши код так, чтобы получить точный вывод.', starter: trace[0], expectedOutput: trace[1], difficulty: 1 }),
      task('code', 'Самостоятельная практика', { description: 'Заверши решение. Не меняй формат итогового вывода.', starter: practice[0], expectedOutput: practice[1], difficulty: 2 }),
      task('quiz', 'Найди риск в коде', { description: 'Что сильнее всего снижает надёжность решения?', options: ['Неучтённые граничные данные и неясный контракт', 'Понятные имена переменных', 'Один конкретный ожидаемый результат', 'Разбиение задачи на шаги'], answer: 0, difficulty: 2 }),
      task('code', 'Задача со звёздочкой', { description: `Создай собственный короткий пример по теме «${title}», сохранив требуемый вывод. Затем упрости решение без изменения поведения.`, starter: `# Решение по теме: ${title}\n${practice[0]}`, expectedOutput: practice[1], difficulty: 3 }),
    ]
  };
}

const lessons = [];
for (const spec of tracks) {
  let previous = '';
  spec.topics.forEach((topic, index) => {
    const lesson = makeLesson(spec.track, spec.level, spec.prefix, topic, index, previous);
    lessons.push(lesson);
    previous = lesson.moduleId;
  });
}

module.exports = lessons;
