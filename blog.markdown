---
layout: index
title: "Muhammad Usman Akram"
---

<div class="content" id="page">
    <div class="container">
	    <div class="blog">
	        <h2>My Log</h2>
	        <ul>
                <li>
                <span>October 25, 2014</span> - <a href="https://gist.github.com/usmanakram232/20d39adf19710d3e4071">How to learn better: Applying effective learning Techniques</a>
                </li>
                <li>
                <span>October 24, 2014</span> - <a href="https://gist.github.com/usmanakram232/2e82d052170cd6701eb5">How to learn better: Chunking</a>
                </li>
	            <li>
	            <span>October 09, 2014</span> - <a href="https://gist.github.com/usmanakram232/2f4cdd7cbf1791d735ad">A GIST as an Entry</a>
                </li>
	        {% for log in site.posts %}
	            <li>
	            <span>{{ log.date | date: "%B %e, %Y" }}</span> - <a href="{{ log.url }}">{{ log.title }}</a>
	            </li>
	        {% endfor %}
	        </ul>
	    </div>
      <hr class="featurette-divider">
    </div> <!-- /container -->
</div>