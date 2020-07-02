import json
import random
import string
import hashlib
import pprint as pp
from collections import Counter

data = {'final': []}  # {category: [questions]}
count = 0
link_count = 0
picture_count = 0
video_count = 0
audio_count = 0
point_values = Counter()
hashes = {}
letters = string.ascii_letters
with open('JEOPARDY_QUESTIONS.json', 'r') as file:
    questions = json.loads(file.read())
    for question in questions:
        if 'href=' in question['question'] or 'of the Clue Crew' in question['question']:
            link_count += 1
            picture_count += question['question'].count('.jpg')
            video_count += question['question'].count('.wmv')
            continue  # don't save questions with links
        if question['question'] in ["'[audio clue]'", "'(audio clue)'"]:
            audio_count += 1
            continue
        if question['question'] in ["'[video clue]'", "'(video clue)'"]:
            video_count += 1
            continue
        hash_object = hashlib.sha256()
        hash_object.update(bytes(question['question'], 'utf8'))
        id_splice = hash_object.hexdigest()[:15]
        if id_splice in hashes:
            duplicate = False
            for item in hashes[id_splice]:
                # it's okay if same answer, but not if same question
                # in the same category
                if item['category'] == question['category']:
                    duplicate = True
                    break
            if duplicate:
                # don't add if a duplicate
                continue
            # add this question to the old id hash to check for future duplicated
            # in case there is more than 1 duplicate
            hashes[id_splice].append(question)
            # hash with category as well if we are keeping it, so
            # that we don't have a duplicate hash
            hash_object.update(bytes(question['category'], 'utf8'))
            id_splice = hash_object.hexdigest()[:15]
            hashes[id_splice] = [question]
        else:
            hashes[id_splice] = [question]
        count += 1
        if question['question'].startswith("'") and question['question'].endswith("'"):
            question['question'] = question['question'][1:-1]
        question['question'] = question['question'].replace("\\'", '')
        question['answer'] = question['answer'].replace("\\'", '')
        question['id'] = id_splice
        if question['round'] in ['Final Jeopardy!', 'Tiebreaker']:
            data['final'].append(question)
            continue
        if question['value'] is None:
            pp.pprint(question)
        try:
            question['value'] = int(question['value'][1:])
        except ValueError:
            question['value'] = int(question['value'][1:].replace(',', ''))
        if question['round'] == 'Double Jeopardy!':
            question['value'] //= 2
        if question['category'] in data:
            if question['value'] in data[question['category']]:
                data[question['category']][question['value']].append(question)
            else:
                data[question['category']][question['value']] = [question]
        else:
            data[question['category']] = {question['value']: [question]}
# assign normal values...some values entered in wrong
normal_values = [200, 400, 600, 800, 1000]
for category in data.keys():
    if category == 'final':
        continue
    for point_value in list(data[category]):
        if point_value in normal_values:
            continue
        replaced = False
        # try to replace w missing normal value
        for normal_value in normal_values:
            if normal_value not in data[category]:
                data[category][normal_value] = data[category].pop(point_value)
                replaced = True
                break
        if replaced:
            continue
        # try to assign close to the points it would have been...from 100,200,300,400,500 game
        # don't add 400 since already a lot of 400s
        replace_question = data[category].pop(point_value)
        choice = 0
        if point_value == 100:
            choice = random.choice([600, 800])
        elif point_value == 300:
            choice = random.choice([600, 800, 1000])
        elif point_value == 500:
            choice = random.choice([800, 1000])
        else:
            choice = random.choice(normal_values)
        data[category][choice].extend(replace_question)

# distribute more in case there are several in one point value but none in another
for category in data.keys():
    if category == 'final':
        continue
    keys = list(data[category])
    if len(keys) == 5:
        # already have all of the normal values filled
        continue
    for point_value in keys:
        if len(data[category][point_value]) > 1:
            extra_values = data[category][point_value][1:]
            data[category][point_value] = [data[category][point_value][0]]
            for value in normal_values:
                if not value in data[category]:
                    data[category][value] = [extra_values.pop()]
                if not extra_values:
                    break
            # add any extra values that we didn't use
            data[category][point_value].extend(extra_values)
            # all done if we have 5 after this
            if len(data[category]) == 5:
                break
# make old value and value keys + count different values
for category in data.keys():
    if category == 'final':
        continue
    for point_value in list(data[category]):
        for i in range(len(data[category][point_value])):
            question = data[category][point_value][i]
            question['oldValue'] = question['value']
            question['value'] = point_value
            point_values[point_value] += 1
save_location = 'processed_jeopardy_questions.json'

five_count = 0
four_count = 0
three_count = 0
for category in list(data.keys()):
    if category == 'final':
        continue
    if len(data[category]) == 5:
        five_count += 1
    elif len(data[category]) == 4:
        data.pop(category)
        four_count += 1
    elif len(data[category]) == 3:
        data.pop(category)
        three_count += 1
    else:
        data.pop(category)
five_count2 = 0
four_count2 = 0
three_count2 = 0
for category in data:
    if category == "TURN OF THE 2nd MILLENNIUM":
        pp.pprint(data[category])
        print('Length:', len(data[category]))
    if len(data[category]) == 5:
        five_count2 += 1
    elif len(data[category]) == 4:
        four_count2 += 1
    elif len(data[category]) == 3:
        three_count2 += 1

with open(save_location, 'w') as save_file:
    save_file.write(json.dumps(data))
print(f'Processed {count} questions and saved them to {save_location}\n')
print(f'Link count: {link_count}')
print(f'Picture count: {picture_count}')
print(f'Video count: {video_count}')
print(f'Audio count: {audio_count}')
print('Point values:')
for point_value in point_values:
    print(f'{point_value}: {point_values[point_value]}')

print(f'Final Jeopardy count: {len(data["final"])}')
print(f'Five count: {five_count}')
print(f'Four count: {four_count}')
print(f'Three count: {three_count}')
print('----------------------------')
print(f'Five count2: {five_count2}')
print(f'Four count2: {four_count2}')
print(f'Three count2: {three_count2}')
