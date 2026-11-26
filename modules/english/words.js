// אוצר המילים של מודול האנגלית — נתונים בלבד (בלי DOM), נבדק ב-tests/english-logic.test.js.
// שורה: "english|עברית|רמה|משפט לדוגמה (לא חובה)|איות חלופי (לא חובה, בריטי — מתקבל בבוחן האיות)".
// רמה: 1 מתחילים, 2 ביניים, 3 מתקדמים.
// תוכן ניטרלי ונקי: משפחה, בית, בית ספר, אוכל, טבע, זמן וכו'. מזהה המילה = האנגלית באותיות קטנות (ייחודי).
(function (root) {
  'use strict';

  const TOPICS = [
    { id: 'family', he: 'משפחה ואנשים' },
    { id: 'home', he: 'בבית' },
    { id: 'school', he: 'בית ספר' },
    { id: 'food', he: 'אוכל ושתייה' },
    { id: 'produce', he: 'פירות וירקות' },
    { id: 'numbers', he: 'מספרים' },
    { id: 'colors', he: 'צבעים' },
    { id: 'time', he: 'זמן וימים' },
    { id: 'body', he: 'גוף ובריאות' },
    { id: 'clothes', he: 'בגדים' },
    { id: 'nature', he: 'טבע ומזג אוויר' },
    { id: 'animals', he: 'בעלי חיים' },
    { id: 'places', he: 'מקומות ותחבורה' },
    { id: 'jobs', he: 'מקצועות' },
    { id: 'verbs', he: 'פעלים' },
    { id: 'adjectives', he: 'תארים' },
    { id: 'basic', he: 'מילים שימושיות' }
  ];

  const LEVELS = [
    { id: 1, he: 'מתחילים' },
    { id: 2, he: 'ביניים' },
    { id: 3, he: 'מתקדמים' }
  ];

  const RAW = {
    family: `
mother|אמא|1|My mother is kind.
father|אבא|1|My father reads a book.
brother|אח|1|My brother is tall.
sister|אחות|1|My sister helps me.
baby|תינוק|1|The baby is sleeping.
family|משפחה|1|We are a big family.
son|בן|1|He is my son.
daughter|בת|1|She is their daughter.
grandfather|סבא|1|My grandfather tells stories.
grandmother|סבתא|1|My grandmother bakes bread.
child|ילד, ילדה|1|The child is happy.
children|ילדים|1|The children play outside.
boy|ילד, נער|1|The boy runs fast.
girl|ילדה, נערה|1|The girl reads a book.
man|איש, גבר|1|The man is at the door.
woman|אישה|1|The woman buys bread.
friend|חבר|1|He is my good friend.
name|שם|1|What is your name?
parents|הורים|2|My parents are at home.
uncle|דוד|2|My uncle lives in Jerusalem.
aunt|דודה|2|My aunt has five children.
cousin|בן דוד, בת דודה|2|My cousin is ten years old.
grandson|נכד|2|Grandmother loves her grandson.
granddaughter|נכדה|2|Her granddaughter is three.
neighbor|שכן|2|Our neighbor is very nice.|neighbour
guest|אורח|2|We have a guest for dinner.
people|אנשים|2|Many people live in the city.
person|אדם|2|He is a good person.
husband|בעל|3|Her husband works in an office.
wife|אישה, רעיה|3|His wife makes a cake.
twins|תאומים|3|The twins look the same.
`,
    home: `
house|בית|1|We live in a small house.
room|חדר|1|This room is clean.
kitchen|מטבח|1|Mother is in the kitchen.
door|דלת|1|Please close the door.
window|חלון|1|Open the window, please.
table|שולחן|1|The food is on the table.
chair|כיסא|1|Sit on the chair.
bed|מיטה|1|I go to bed at eight.
key|מפתח|1|I have the key.
clock|שעון|1|The clock is on the wall.
cup|כוס|1|I drink from a cup.
plate|צלחת|1|Put the bread on the plate.
spoon|כף|1|I eat soup with a spoon.
fork|מזלג|1|Where is my fork?
box|קופסה|1|The box is empty.
bag|תיק|1|My bag is heavy.
bedroom|חדר שינה|2|My bedroom is quiet.
bathroom|חדר אמבטיה|2|The bathroom is clean.
sofa|ספה|2|Grandfather sits on the sofa.
lamp|מנורה|2|Turn on the lamp.
floor|רצפה|2|The floor is wet.
wall|קיר|2|There is a picture on the wall.
roof|גג|2|The bird is on the roof.
knife|סכין|2|Be careful with the knife.
bowl|קערה|2|The soup is in the bowl.
towel|מגבת|2|Here is a clean towel.
soap|סבון|2|Wash your hands with soap.
mirror|מראה|2|The mirror is in the bathroom.
stairs|מדרגות|2|We go up the stairs.
garden|גינה|2|There are flowers in the garden.
oven|תנור|2|The cake is in the oven.
closet|ארון|2|My clothes are in the closet.
blanket|שמיכה|2|The blanket is warm.
pillow|כרית|2|My pillow is soft.
candle|נר|2|We light the candles.
bottle|בקבוק|2|The bottle is full of water.
basket|סל|2|The apples are in the basket.
refrigerator|מקרר|3|The milk is in the refrigerator.
shelf|מדף|3|The books are on the shelf.
broom|מטאטא|3|Clean the floor with a broom.
balcony|מרפסת|3|We sit on the balcony.
ceiling|תקרה|3|The ceiling is white.
curtain|וילון|3|Close the curtain, please.
`,
    school: `
school|בית ספר|1|I go to school every day.
teacher|מורה|1|The teacher is kind.
student|תלמיד|1|He is a good student.
book|ספר|1|This book is new.
notebook|מחברת|1|Write in your notebook.
pen|עט|1|I write with a pen.
pencil|עיפרון|1|My pencil is short.
question|שאלה|1|I have a question.
answer|תשובה|1|That is the right answer.
word|מילה|1|Read the word again.
paper|נייר|1|I need a piece of paper.
picture|תמונה|1|Look at the picture.
English|אנגלית|1|We learn English.
Hebrew|עברית|1|We speak Hebrew at home.
eraser|מחק|2|Can I use your eraser?
ruler|סרגל|2|Draw a line with a ruler.
classroom|כיתה|2|Our classroom is big.
desk|שולחן כתיבה|2|My books are on the desk.
board|לוח|2|The teacher writes on the board.
lesson|שיעור|2|The lesson starts now.
homework|שיעורי בית|2|I do my homework after lunch.
test|מבחן|2|We have a test tomorrow.
page|עמוד|2|Open your book to page ten.
story|סיפור|2|Tell me a story.
language|שפה|2|English is a language.
library|ספרייה|2|We read books in the library.
scissors|מספריים|2|Cut the paper with scissors.
glue|דבק|2|I need some glue.
map|מפה|2|Look at the map.
break|הפסקה|2|We eat during the break.
letter|אות, מכתב|2|I write a letter to my grandmother.
idea|רעיון|3|That is a good idea.
example|דוגמה|3|Give me an example.
mistake|טעות|3|Everyone makes a mistake sometimes.
sentence|משפט|3|Read the sentence slowly.
dictionary|מילון|3|Look in the dictionary.
chalk|גיר|3|The chalk is white.
principal|מנהל בית הספר|3|The principal visits our class.
`,
    food: `
bread|לחם|1|We eat bread every day.
water|מים|1|I drink water.
milk|חלב|1|The milk is cold.
egg|ביצה|1|I eat an egg for breakfast.
cheese|גבינה|1|This cheese is good.
soup|מרק|1|The soup is hot.
fish|דג|1|We eat fish.
juice|מיץ|1|I like orange juice.
tea|תה|1|Grandmother drinks tea.
cake|עוגה|1|Mother bakes a cake.
cookie|עוגייה|1|Can I have a cookie?
food|אוכל|1|The food is ready.
butter|חמאה|2|Put butter on the bread.
rice|אורז|2|We eat rice and fish.
meat|בשר|2|The meat is in the oven.
chicken|עוף|2|We have chicken for dinner.
salt|מלח|2|Pass the salt, please.
sugar|סוכר|2|I want tea with sugar.
honey|דבש|2|Honey is sweet.
coffee|קפה|2|Father drinks coffee.
breakfast|ארוחת בוקר|2|I eat breakfast at seven.
lunch|ארוחת צהריים|2|Lunch is at one.
dinner|ארוחת ערב|2|We eat dinner together.
sandwich|כריך|2|I have a sandwich in my bag.
salad|סלט|2|The salad is fresh.
oil|שמן|2|Mother cooks with oil.
jam|ריבה|2|I like bread with jam.
chocolate|שוקולד|2|The chocolate is sweet.
candy|ממתק|2|Don't eat too much candy.
pasta|פסטה|2|The children like pasta.
yogurt|יוגורט|2|I eat yogurt in the morning.
meal|ארוחה|3|This is a good meal.
flour|קמח|3|We need flour for the bread.
snack|חטיף|3|I take a snack to school.
dessert|קינוח|3|What is for dessert?
recipe|מתכון|3|This is Grandmother's recipe.
pot|סיר|3|The soup is in the pot.
pan|מחבת|3|Fry the egg in the pan.
`,
    produce: `
apple|תפוח|1|I eat an apple.
banana|בננה|1|The banana is yellow.
orange|תפוז|1|This orange is sweet.
grapes|ענבים|1|The grapes are green.
lemon|לימון|1|The lemon is sour.
tomato|עגבנייה|1|The tomato is red.
cucumber|מלפפון|1|I like cucumber in my salad.
carrot|גזר|1|The rabbit eats a carrot.
potato|תפוח אדמה|1|Mother cooks a potato.
fruit|פרי|1|Fruit is good for you.
vegetable|ירק|1|Eat a vegetable every day.
watermelon|אבטיח|2|We eat watermelon in summer.
melon|מלון (פרי)|2|The melon is sweet.
pear|אגס|2|This pear is soft.
peach|אפרסק|2|The peach is ripe.
cherry|דובדבן|2|The cherry is red.
strawberry|תות|2|I like strawberry jam.
olive|זית|2|Olive oil comes from olives.
onion|בצל|2|Cut the onion.
lettuce|חסה|2|Wash the lettuce well.
corn|תירס|2|The corn is yellow.
pepper|פלפל|2|The pepper is green.
mango|מנגו|2|The mango is sweet.
avocado|אבוקדו|2|I eat bread with avocado.
nuts|אגוזים|2|Squirrels eat nuts.
plum|שזיף|3|The plum is purple.
pomegranate|רימון|3|A pomegranate has many seeds.
dates|תמרים|3|Dates are very sweet.
fig|תאנה|3|The fig tree is big.
garlic|שום|3|Add some garlic to the soup.
cabbage|כרוב|3|Cabbage is a vegetable.
pumpkin|דלעת|3|We make soup from pumpkin.
mushroom|פטרייה|3|The mushroom is in the forest.
beans|שעועית|3|We eat rice and beans.
peas|אפונה|3|The peas are green.
apricot|משמש|3|The apricot is orange.
`,
    numbers: `
zero|אפס|1
one|אחת, אחד|1|I have one brother.
two|שתיים, שניים|1|I have two hands.
three|שלוש, שלושה|1|There are three apples.
four|ארבע, ארבעה|1|A chair has four legs.
five|חמש, חמישה|1|I have five fingers on each hand.
six|שש, שישה|1|There are six eggs.
seven|שבע, שבעה|1|A week has seven days.
eight|שמונה|1|I go to bed at eight.
nine|תשע, תשעה|1|My sister is nine.
ten|עשר, עשרה|1|I can count to ten.
number|מספר|1|What is your house number?
eleven|אחת עשרה|2
twelve|שתים עשרה|2|A year has twelve months.
thirteen|שלוש עשרה|2
fourteen|ארבע עשרה|2
fifteen|חמש עשרה|2
sixteen|שש עשרה|2
seventeen|שבע עשרה|2
eighteen|שמונה עשרה|2
nineteen|תשע עשרה|2
twenty|עשרים|2|There are twenty children in my class.
thirty|שלושים|2
forty|ארבעים|2
fifty|חמישים|2
sixty|שישים|2
seventy|שבעים|2
eighty|שמונים|2
ninety|תשעים|2
hundred|מאה|2|My grandfather is almost one hundred.
half|חצי|2|I eat half of the apple.
first|ראשון|2|Sunday is the first day.
thousand|אלף|3
million|מיליון|3
third|שלישי|3|This is my third book.
pair|זוג|3|I need a new pair of shoes.
dozen|תריסר|3|We buy a dozen eggs.
`,
    colors: `
color|צבע|1|What color is your bag?|colour
red|אדום|1|The apple is red.
blue|כחול|1|The sky is blue.
green|ירוק|1|The grass is green.
yellow|צהוב|1|The sun is yellow.
black|שחור|1|My shoes are black.
white|לבן|1|The snow is white.
brown|חום|1|The table is brown.
pink|ורוד|2|The flower is pink.
purple|סגול|2|The grapes are purple.
gray|אפור|2|The clouds are gray.|grey
light blue|תכלת|2|The sky is light blue today.
dark|כהה, חשוך|2|It is dark at night.
bright|בהיר, מואר|2|The room is bright.
golden|זהוב|3|The bread is golden.
silver|כסוף, כסף|3|The cup is silver.
`,
    time: `
day|יום|1|Have a good day.
night|לילה|1|The moon shines at night.
morning|בוקר|1|I wake up in the morning.
evening|ערב|1|We eat dinner in the evening.
week|שבוע|1|A week has seven days.
month|חודש|1|This month is cold.
year|שנה|1|I am eight years old.
today|היום|1|Today is Monday.
tomorrow|מחר|1|See you tomorrow.
yesterday|אתמול|1|Yesterday it rained.
hour|שעה|1|The lesson is one hour long.
time|זמן|1|What time is it?
now|עכשיו|1|Come here now.
Sunday|יום ראשון|1|We go to school on Sunday.
Monday|יום שני|1|Today is Monday.
Tuesday|יום שלישי|1|I have a test on Tuesday.
Wednesday|יום רביעי|1|Wednesday is in the middle of the week.
Thursday|יום חמישי|1|On Thursday we clean the house.
Friday|יום שישי|1|On Friday we prepare for Shabbat.
Saturday|שבת|1|Saturday is a day of rest.
afternoon|אחר הצהריים|2|I play in the afternoon.
minute|דקה|2|Wait a minute, please.
second|שנייה|2|One minute has sixty seconds.
later|אחר כך|2|I will do it later.
always|תמיד|2|She is always kind.
never|אף פעם|2|He is never late.
sometimes|לפעמים|2|Sometimes it snows.
early|מוקדם|2|I wake up early.
late|מאוחר|2|It is late. Go to sleep.
noon|צהריים|2|We eat lunch at noon.
winter|חורף|2|It is cold in winter.
spring|אביב|2|Flowers grow in spring.
summer|קיץ|2|It is hot in summer.
autumn|סתיו|2|Leaves fall in autumn.
often|לעיתים קרובות|3|We often visit our grandmother.
date|תאריך|3|What is the date today?
calendar|לוח שנה|3|Look at the calendar.
midnight|חצות|3|It is midnight.
weekend|סוף שבוע|3|We rest on the weekend.
soon|בקרוב|3|Father will come home soon.
already|כבר|3|I already did my homework.
ago|לפני (זמן)|3|He came two days ago.
`,
    body: `
head|ראש|1|Put a hat on your head.
eye|עין|1|Close your eyes.
ear|אוזן|1|I hear with my ears.
nose|אף|1|I smell with my nose.
mouth|פה|1|Open your mouth.
tooth|שן|1|I brush my teeth.
hair|שיער|1|Her hair is long.
face|פנים|1|Wash your face.
hand|יד|1|Give me your hand.
finger|אצבע|1|I have ten fingers.
leg|רגל|1|My leg hurts.
foot|כף רגל|1|My foot is cold.
body|גוף|1|Keep your body healthy.
arm|זרוע|2|My arm is strong.
knee|ברך|2|He hurt his knee.
shoulder|כתף|2|Put the bag on your shoulder.
back|גב|2|My back hurts.
neck|צוואר|2|The giraffe has a long neck.
heart|לב|2|The heart is very important.
tongue|לשון|2|Show me your tongue.
stomach|בטן|2|My stomach is full.
beard|זקן|2|Grandfather has a white beard.
lip|שפה (בפה)|3|My lip is dry.
skin|עור|3|Wash your skin with soap.
bone|עצם|3|The dog has a bone.
blood|דם|3|The heart pumps blood.
chin|סנטר|3|He has a beard on his chin.
thumb|אגודל|3|The thumb is short.
eyebrow|גבה|3|He raised an eyebrow.
toe|בוהן|3|I hurt my toe.
elbow|מרפק|3|Don't put your elbows on the table.
health|בריאות|3|Health is very important.
medicine|תרופה|3|Take the medicine after the meal.
`,
    clothes: `
clothes|בגדים|1|My clothes are clean.
shirt|חולצה|1|He wears a white shirt.
pants|מכנסיים|1|These pants are new.
dress|שמלה|1|She has a long blue dress.
shoes|נעליים|1|Put on your shoes.
socks|גרביים|1|My socks are warm.
hat|כובע|1|Father wears a black hat.
coat|מעיל|1|Wear a coat. It is cold.
skirt|חצאית|2|Her skirt is long.
sweater|סוודר|2|This sweater is warm.
scarf|צעיף|2|I wear a scarf in winter.
gloves|כפפות|2|My gloves are in my pocket.
boots|מגפיים|2|Wear boots in the rain.
belt|חגורה|2|He has a brown belt.
button|כפתור|2|A button is missing.
pocket|כיס|2|The key is in my pocket.
glasses|משקפיים|2|Grandmother wears glasses.
umbrella|מטרייה|2|Take an umbrella. It is raining.
pajamas|פיג'מה|2|Put on your pajamas.|pyjamas
sandals|סנדלים|2|I wear sandals in summer.
watch|שעון יד|2|My watch is new.
suit|חליפה|3|He wears a suit.
tie|עניבה|3|His tie is blue.
sleeve|שרוול|3|The sleeve is long.
uniform|תלבושת אחידה|3|We wear a school uniform.
wallet|ארנק|3|My money is in my wallet.
ring|טבעת|3|The ring is gold.
`,
    nature: `
sun|שמש|1|The sun is hot.
moon|ירח|1|The moon is bright tonight.
star|כוכב|1|I see a star in the sky.
sky|שמיים|1|The sky is blue.
cloud|ענן|1|There is a big cloud.
rain|גשם|1|The rain is good for the trees.
snow|שלג|1|The snow is white.
wind|רוח|1|The wind is strong.
tree|עץ|1|The tree is tall.
flower|פרח|1|This flower smells good.
sea|ים|1|We look at the sea.
weather|מזג אוויר|2|The weather is nice today.
grass|דשא|2|The grass is green.
leaf|עלה|2|The leaf is yellow.
river|נהר|2|The river is long.
mountain|הר|2|The mountain is high.
stone|אבן|2|The stone is heavy.
sand|חול|2|The children play in the sand.
fire|אש|2|Don't touch the fire.
earth|כדור הארץ, אדמה|2|We live on the earth.
rainbow|קשת בענן|2|Look at the rainbow!
lake|אגם|2|The lake is quiet.
forest|יער|2|There are many trees in the forest.
field|שדה|2|The farmer works in the field.
desert|מדבר|2|It is hot in the desert.
air|אוויר|2|The air is fresh.
ice|קרח|2|The ice is cold.
world|עולם|2|The world is big.
nature|טבע|2|We love nature.
storm|סערה|3|There is a storm outside.
island|אי|3|They live on an island.
ocean|אוקיינוס|3|The ocean is very deep.
hill|גבעה|3|The house is on a hill.
wave|גל|3|The wave is big.
seed|זרע|3|Plant the seed in the ground.
root|שורש|3|The tree has deep roots.
branch|ענף|3|The bird sits on a branch.
thunder|רעם|3|I hear thunder.
lightning|ברק|3|Lightning comes before thunder.
fog|ערפל|3|There is fog this morning.
valley|עמק|3|The village is in a valley.
`,
    animals: `
animal|חיה, בעל חיים|1|The cow is a big animal.
dog|כלב|1|The dog is in the yard.
cat|חתול|1|The cat drinks milk.
bird|ציפור|1|The bird can fly.
horse|סוס|1|The horse runs fast.
cow|פרה|1|The cow gives milk.
sheep|כבשה|1|The sheep are in the field.
lion|אריה|1|The lion is strong.
bear|דוב|1|The bear is big and brown.
elephant|פיל|1|The elephant has big ears.
monkey|קוף|1|The monkey climbs the tree.
mouse|עכבר|1|The mouse is small.
goat|עז|2|The goat eats grass.
rabbit|ארנב|2|The rabbit is white.
duck|ברווז|2|The duck swims in the lake.
hen|תרנגולת|2|The hen lays eggs.
bee|דבורה|2|The bee makes honey.
ant|נמלה|2|The ant is very small.
butterfly|פרפר|2|The butterfly is beautiful.
frog|צפרדע|2|The frog jumps.
snake|נחש|2|Be careful, there is a snake.
camel|גמל|2|The camel lives in the desert.
donkey|חמור|2|The donkey carries the bags.
tiger|טיגריס|2|The tiger has stripes.
leopard|נמר|3|The leopard has spots.
giraffe|ג'ירפה|2|The giraffe is very tall.
zebra|זברה|2|The zebra is black and white.
turtle|צב|2|The turtle is slow.
dove|יונה|2|The dove is white.
zoo|גן חיות|2|We see a lion at the zoo.
deer|צבי|3|The deer runs fast.
eagle|נשר|3|The eagle flies high.
wolf|זאב|3|The wolf lives in the forest.
fox|שועל|3|The fox is clever.
whale|לוויתן|3|The whale is very big.
owl|ינשוף|3|The owl is awake at night.
spider|עכביש|3|The spider is on the wall.
insect|חרק|3|An ant is an insect.
lamb|טלה|3|The lamb is with its mother.
`,
    places: `
city|עיר|1|Jerusalem is a big city.
street|רחוב|1|We live on this street.
shop|חנות|1|The shop is open.
car|מכונית|1|Father drives the car.
bus|אוטובוס|1|We go to school by bus.
train|רכבת|1|The train is fast.
here|כאן|1|Come here, please.
there|שם (במקום ההוא)|1|The book is over there.
market|שוק|2|We buy fruit at the market.
park|פארק|2|The children play in the park.
hospital|בית חולים|2|The doctor works in a hospital.
bank|בנק|2|The bank is near the shop.
post office|סניף דואר|2|I send a letter at the post office.
synagogue|בית כנסת|2|We pray in the synagogue.
village|כפר|2|My uncle lives in a village.
road|כביש, דרך|2|The road is long.
bridge|גשר|2|The bridge is over the river.
airplane|מטוס|2|The airplane flies high.
bicycle|אופניים|2|I ride my bicycle.
boat|סירה|2|The boat is on the lake.
taxi|מונית|2|We take a taxi.
station|תחנה|2|The bus station is near.
country|ארץ, מדינה|2|Israel is a small country.
building|בניין|2|The building is very tall.
playground|גן שעשועים|2|The children are at the playground.
ticket|כרטיס|2|I need a bus ticket.
left|שמאל|2|Turn left here.
kindergarten|גן ילדים|2|My little brother goes to kindergarten.
restaurant|מסעדה|2|The restaurant is closed.
ship|אונייה|3|The ship is on the sea.
airport|שדה תעופה|3|We go to the airport.
office|משרד|3|My father works in an office.
factory|מפעל|3|The factory makes bread.
corner|פינה|3|The shop is on the corner.
traffic light|רמזור|3|Stop at the traffic light.
pharmacy|בית מרקחת|3|We buy medicine at the pharmacy.
north|צפון|3|Haifa is in the north.
south|דרום|3|The desert is in the south.
east|מזרח|3|The sun rises in the east.
west|מערב|3|The sun sets in the west.
`,
    jobs: `
doctor|רופא|1|The doctor helps sick people.
driver|נהג|1|The bus driver is kind.
farmer|חקלאי|2|The farmer grows vegetables.
baker|אופה|2|The baker makes bread.
nurse|אחות (רפואית)|2|The nurse gives medicine.
policeman|שוטר|2|The policeman helps us.
firefighter|כבאי|2|The firefighter is brave.
pilot|טייס|2|The pilot flies the airplane.
worker|עובד, פועל|2|The worker builds a house.
king|מלך|2|King David was wise.
rabbi|רב|2|The rabbi teaches us.
job|עבודה, משרה|2|My father has a good job.
chef|טבח, שף|2|The chef cooks the meal.
tailor|חייט|3|The tailor makes a suit.
carpenter|נגר|3|The carpenter makes a table.
builder|בנאי|3|The builder builds a wall.
shopkeeper|בעל חנות|3|The shopkeeper is friendly.
mailman|דוור|3|The mailman brings letters.
dentist|רופא שיניים|3|The dentist checks my teeth.
judge|שופט|3|The judge is fair.
`,
    verbs: `
go|ללכת, לנסוע|1|We go to school.
come|לבוא|1|Come here, please.
eat|לאכול|1|We eat lunch at one.
drink|לשתות|1|Drink some water.
sleep|לישון|1|The baby sleeps.
read|לקרוא (בספר)|1|I read a book.
write|לכתוב|1|I write a letter.
speak|לדבר|1|We speak English.
see|לראות|1|I see a bird.
hear|לשמוע|1|I hear the rain.
run|לרוץ|1|The boy runs fast.
jump|לקפוץ|1|The frog can jump.
sit|לשבת|1|Please sit down.
stand|לעמוד|1|Stand up, please.
open|לפתוח|1|Open the door.
close|לסגור|1|Close the window.
give|לתת|1|Give me the pen.
take|לקחת|1|Take an apple.
help|לעזור|1|Can you help me?
learn|ללמוד|1|I learn English.
play|לשחק|1|The children play in the park.
like|לחבב, לאהוב|1|I like apples.
want|לרצות|1|I want some water.
have|יש ל־|1|I have two brothers.
know|לדעת, להכיר|1|I know the answer.
do|לעשות|1|I do my homework.
listen|להקשיב|2|Listen to the teacher.
look|להסתכל|2|Look at the board.
walk|ללכת ברגל|2|We walk to school.
teach|ללמד|2|The teacher teaches us.
study|ללמוד, לעיין|2|We study every day.
work|לעבוד|2|My father works hard.
wash|לרחוץ, לשטוף|2|Wash your hands.
cook|לבשל|2|Mother cooks dinner.
buy|לקנות|2|We buy bread.
sell|למכור|2|The baker sells bread.
pay|לשלם|2|We pay at the shop.
love|לאהוב|2|I love my family.
need|להזדקק, צריך|2|I need a pencil.
think|לחשוב|2|Think before you answer.
understand|להבין|2|I understand the lesson.
remember|לזכור|2|Remember to bring your book.
forget|לשכוח|2|Don't forget your key.
ask|לשאול|2|Ask the teacher.
say|לומר|2|Say thank you.
tell|לספר|2|Tell me a story.
call|לקרוא (בשם), להתקשר|2|Call your brother for dinner.
find|למצוא|2|I can't find my pen.
lose|לאבד|2|Don't lose your key.
bring|להביא|2|Bring your notebook.
carry|לשאת, לסחוב|2|I carry my bag.
draw|לצייר|2|I draw a tree.
clean up|לנקות, לסדר|2|We clean up the room.
cut|לחתוך|2|Cut the bread.
climb|לטפס|2|The monkey climbs the tree.
swim|לשחות|2|The fish swim in the river.
fly|לעוף|2|Birds fly in the sky.
fall|ליפול|2|Leaves fall in autumn.
grow|לגדול, לגדל|2|The tree grows tall.
build|לבנות|2|They build a house.
live|לגור, לחיות|2|We live in Bnei Brak.
wait|לחכות|2|Wait for me, please.
start|להתחיל|2|The lesson starts at eight.
finish|לסיים|2|I finish my homework.
try|לנסות|2|Try again.
use|להשתמש|2|Use a pencil.
make|להכין, ליצור|2|We make a salad.
get|לקבל|2|I get a letter.
put|לשים|2|Put the book on the table.
send|לשלוח|2|Send a letter to Grandmother.
show|להראות|2|Show me your picture.
smile|לחייך|2|The baby smiles.
laugh|לצחוק|2|The children laugh.
cry|לבכות|2|The baby cries.
travel|לנסוע, לטייל|2|We travel to Jerusalem.
ride|לרכוב|2|I ride my bicycle.
pray|להתפלל|2|We pray in the morning.
visit|לבקר|2|We visit our grandparents.
thank|להודות|2|We thank the teacher.
count|לספור|2|Count to ten.
rest|לנוח|2|Rest after lunch.
hold|להחזיק|2|Hold my hand.
drive|לנהוג|3|My father drives a car.
share|לחלוק, לשתף|3|Share your cookies with your friend.
explain|להסביר|3|The teacher explains the lesson.
choose|לבחור|3|Choose a book.
decide|להחליט|3|I decide to help.
prepare|להתכונן, להכין|3|We prepare for the test.
arrive|להגיע|3|The bus arrives at eight.
leave|לעזוב, לצאת|3|We leave the house at seven.
move|לזוז, להזיז, לעבור|3|Please move your chair.
turn|לפנות, לסובב|3|Turn right at the corner.
keep|לשמור|3|Keep your room clean.
change|לשנות, להחליף|3|Change your shirt.
believe|להאמין|3|I believe you.
hope|לקוות|3|I hope you feel better.
return|לחזור, להחזיר|3|Return the book to the library.
enter|להיכנס|3|Enter the room quietly.
push|לדחוף|3|Push the door.
pull|למשוך|3|Pull the rope.
plant|לשתול|3|We plant a tree.
borrow|לשאול (חפץ)|3|Can I borrow your pen?
`,
    adjectives: `
big|גדול|1|The elephant is big.
small|קטן|1|The mouse is small.
good|טוב|1|This is a good book.
bad|רע|1|The weather is bad today.
happy|שמח|1|I am happy today.
sad|עצוב|1|Why are you sad?
hot|חם|1|The tea is hot.
cold|קר|1|The water is cold.
new|חדש|1|I have new shoes.
old|ישן, זקן (בגיל)|1|This book is old.
young|צעיר|1|My brother is young.
tall|גבוה|1|My father is tall.
short|נמוך, קצר|1|The pencil is short.
long|ארוך|1|The river is long.
fast|מהיר|1|The train is fast.
slow|איטי|1|The turtle is slow.
beautiful|יפה|1|The garden is beautiful.
nice|נחמד|1|She is very nice.
clean|נקי|1|My room is clean.
full|מלא|2|The cup is full.
empty|ריק|2|The box is empty.
dirty|מלוכלך|2|My hands are dirty.
easy|קל (לא קשה)|2|The test is easy.
hard|קשה|2|This question is hard.
heavy|כבד|2|The bag is heavy.
rich|עשיר|2|The king is rich.
poor|עני|2|We help poor people.
strong|חזק|2|The lion is strong.
weak|חלש|2|I feel weak today.
hungry|רעב|2|I am hungry.
thirsty|צמא|2|I am thirsty. Give me water.
tired|עייף|2|I am tired. I want to sleep.
sick|חולה|2|My brother is sick today.
healthy|בריא|2|Fruit is healthy.
kind|אדיב, טוב לב|2|The nurse is kind.
quiet|שקט|2|The library is quiet.
loud|רועש|2|The street is loud.
busy|עסוק|2|Mother is busy now.
wet|רטוב|2|The floor is wet.
dry|יבש|2|My clothes are dry.
sweet|מתוק|2|Honey is sweet.
sour|חמוץ|2|The lemon is sour.
soft|רך|2|The pillow is soft.
closed|סגור|2|The shop is closed.
right|נכון, ימין|2|That is the right answer.
wrong|שגוי, לא נכון|2|That answer is wrong.
funny|מצחיק|2|The story is funny.
angry|כועס|2|Don't be angry.
afraid|מפחד|2|The child is afraid of the dark.
clever|פיקח, חכם|2|The fox is clever.
cheap|זול|2|The apples are cheap today.
expensive|יקר (במחיר)|2|This watch is expensive.
near|קרוב|2|The school is near my house.
far|רחוק|2|The sea is far from here.
ready|מוכן|2|Dinner is ready.
thin|דק, רזה|2|The book is thin.
round|עגול|2|The ball is round.
warm|חמים|2|The blanket is warm.
great|נהדר|2|You did a great job.
difficult|קשה (מסובך)|3|The test is difficult.
free|חופשי, פנוי|3|I am free in the afternoon.
bitter|מר|3|This medicine is bitter.
same|אותו, זהה|3|We have the same book.
different|שונה|3|The twins look different.
important|חשוב|3|This lesson is important.
brave|אמיץ|3|The firefighter is brave.
careful|זהיר|3|Be careful on the stairs.
wise|חכם, נבון|3|King Solomon was very wise.
polite|מנומס|3|He is a polite boy.
honest|ישר, הגון|3|He is an honest man.
wonderful|נפלא|3|What a wonderful day!
dangerous|מסוכן|3|Fire is dangerous.
safe|בטוח|3|The children are safe at home.
deep|עמוק|3|The sea is deep.
cool|קריר|3|The evening is cool.
simple|פשוט|3|This is a simple question.
`,
    basic: `
I|אני|1|I am a student.
you|אתה, את, אתם|1|You are my friend.
he|הוא|1|He is my brother.
she|היא|1|She is my sister.
we|אנחנו|1|We are a family.
they|הם, הן|1|They are at school.
it|זה (דבר), הוא (דבר), היא (דבר)|1|It is a cat.
my|שלי|1|This is my book.
your|שלך, שלכם|1|Is this your pen?
his|שלו|1|This is his hat.
her|שלה|1|This is her dress.
our|שלנו|1|This is our house.
their|שלהם, שלהן|1|This is their car.
what|מה|1|What is this?
who|מי|1|Who is at the door?
where|איפה|1|Where is my bag?
when|מתי|1|When do we eat?
why|למה|1|Why are you sad?
how|איך|1|How do you go to school?
yes|כן|1|Yes, I can.
no|לא|1|No, thank you.
please|בבקשה|1|Please sit down.
thank you|תודה|1|Thank you for the help.
sorry|סליחה, מצטער|1|I am sorry.
hello|שלום|1|Hello, how are you?
goodbye|להתראות|1|Goodbye, see you tomorrow.
good morning|בוקר טוב|1|Good morning, Mother.
good night|לילה טוב|1|Good night, sleep well.
and|ו־|1|Bread and butter.
or|או|1|Tea or coffee?
with|עם|1|I go with my father.
in|בתוך, ב־|1|The pen is in the bag.
on|על|1|The cup is on the table.
under|מתחת|1|The cat is under the bed.
very|מאוד|1|It is very cold.
this|זה, זאת|1|This is my brother.
also|גם|1|I also want tea.
how many|כמה (במספר)|2|How many apples do you have?
which|איזה, איזו|2|Which book do you want?
but|אבל|2|I am tired, but happy.
without|בלי|2|Tea without sugar, please.
between|בין|2|The ball is between the chairs.
behind|מאחורי|2|The garden is behind the house.
in front of|מול, לפני (במקום)|2|The bus stops in front of the school.
only|רק|2|I have only one pen.
all|כל, כולם|2|All the children are here.
every|כל (אחד)|2|I read every day.
some|קצת, כמה|2|I want some water.
many|הרבה (לספירה)|2|There are many stars.
much|הרבה (כמות)|2|Thank you very much.
more|יותר, עוד|2|I want more soup.
less|פחות|2|Eat less candy.
because|כי, מפני ש־|2|I am happy because it is sunny.
if|אם|2|If it rains, take an umbrella.
then|אז|2|First wash your hands, then eat.
that|ההוא, ההיא, ש־|2|That house is big.
these|אלה, אלו|2|These books are new.
again|שוב|2|Say it again, please.
together|ביחד|2|We eat together.
maybe|אולי|2|Maybe it will rain.
after|אחרי|2|I play after school.
from|מ־, מן|2|I am from Israel.
to|אל, ל־|2|We go to school.
of course|כמובן|3|Of course I can help.
enough|מספיק|3|We have enough bread.
nothing|כלום|3|There is nothing in the box.
something|משהו|3|I want something to drink.
everything|הכול|3|Everything is ready.
someone|מישהו|3|Someone is at the door.
about|על (נושא), בערך|3|This story is about a king.
before|לפני|3|Wash your hands before you eat.
until|עד|3|Wait until I come.
`
  };

  function parse() {
    const out = [];
    for (const t of TOPICS) {
      const block = RAW[t.id] || '';
      for (const line of block.split('\n')) {
        const s = line.trim();
        if (!s) continue;
        const [en, he, lvl, ex, alt] = s.split('|');
        const w = { id: en.trim().toLowerCase(), en: en.trim(), he: he.trim(), topic: t.id, level: Number(lvl) };
        if (ex && ex.trim()) w.ex = ex.trim();
        if (alt && alt.trim()) w.alt = alt.split(',').map(a => a.trim()).filter(Boolean);
        out.push(w);
      }
    }
    return out;
  }

  const WORDS = parse();
  const API = { TOPICS, LEVELS, WORDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.EnglishWords = API;
})(this);
